//
// unit: 壓力測試之入口(src/WScanStress.mjs), 以示範服務(test/tools/demoServer.mjs, 埠 8091)為受測系統
//
// 對應規則(src/WScanStress.mjs 之 jsdoc 與檔頭, README 之〈設計〉〈情境〉〈Options〉〈session 與遮蔽〉):
//   參數檢查(不需網路): 須給情境(buildScenario 或 scenario); 固定之情境於下載 k6 與取 session 前檢查格式; levels 須為正整數之非空陣列;
//     ramp、dur、gate.timeout 須為 k6 之時間格式, gap 為非負數, batchPerHost 為正整數, procPorts 之值為埠號, gate 之門檻為非負數,
//     getSessions、releaseSessions、buildScenario 給了則須為函數, label 不含路徑分隔與檔名禁用字元;
//     指定之 k6 不存在或不可執行即拋錯; 以上皆不建立結果資料夾、不取 session
//   實跑(需 k6: 環境變數 K6_PATH 或 PATH 內之 k6.exe, 皆無則自 GitHub 下載至 test/_tmp):
//     smoke 為 1 位虛擬使用者走 1 趟; 每位虛擬使用者以 getSessions 取得 session, 其值以 {{鍵}} 代入網址、標頭與文字本體; 二進位本體以 base64 給予(共用或各自);
//     requests 之 steps 依序、同一步並行, timer 記錄所需之時間與是否全部成功; stay 停留 sec 秒並依 every 週期發出;
//     結果資料夾含 meta.json、smoke/(或 vusNNN/)之 summary.json、sys.json、k6.log 與 report.txt, 清單檔結束即刪;
//     k6.log 與 meta.json 不含 session 之值; 結束時以 releaseSessions 釋放, 未能釋放者存於 fpPending(預設結果資料夾之 sessions_pending.json);
//     逐級時任一級觸發安全閘(內容檢核失敗比例超過 5% 等)即不再加壓; 附加之 meta(物件或於取得 session 與情境後產生之函數)併入 meta.json;
//     取得 session 後任何失敗(情境格式、meta、k6)皆釋放 session 並刪清單檔, 原始錯誤不被釋放之錯誤遮蓋;
//     releaseSessions 拋錯或回傳非陣列視為全部未能釋放(存於 fpPending); getSessions 須回傳非空陣列
//
import { strict as assert } from 'assert'
import fs from 'fs'
import path from 'path'
import wss from '../src/WScanStress.mjs'
import startDemoServer from './tools/demoServer.mjs'
import findK6 from './tools/findK6.mjs'


let fd = path.resolve('./test/_tmp/WScanStress')
let fdOut = path.join(fd, 'out')
let k6Path = findK6()


//ls, 列出資料夾內之檔案(以/分隔之相對路徑, 排序)
let ls = (dir) => {
    let out = []
    let walk = (d) => {
        for (let ent of fs.readdirSync(d, { withFileTypes: true })) {
            let p = path.join(d, ent.name)
            if (ent.isDirectory()) {
                walk(p)
            }
            else {
                out.push(path.relative(dir, p).split(path.sep).join('/'))
            }
        }
    }
    if (fs.existsSync(dir)) {
        walk(dir)
    }
    return out.sort()
}


describe('WScanStress: 參數檢查', function () {

    let called
    let getSessions = async (n) => {
        called = true
        return Array.from({ length: n }, () => ({}))
    }
    let fdChk = path.join(fd, 'chk')

    beforeEach(function () {
        called = false
    })

    after(function () {
        fs.rmSync(fdChk, { recursive: true, force: true })
        fs.rmSync(path.join(fd, 'fake'), { recursive: true, force: true })
    })

    it('未給情境: 拋錯', async function () {
        //規則: 須給情境(opt.buildScenario 或 opt.scenario)
        await assert.rejects(wss(fdChk, {}), /須給情境/)
    })

    it('固定之情境格式有誤: 於下載 k6 與取 session 前拋錯, 不建立結果資料夾', async function () {
        //規則: 固定之情境先檢查格式(不下載 k6、不取 session)
        await assert.rejects(wss(fdChk, { scenario: { phases: [{ kind: 'x' }] }, getSessions }), /kind 須為 requests、stay 或 sleep/)
        assert.equal(called, false)
        assert.ok(!fs.existsSync(fdChk))
    })

    it('levels 非正整數: 拋錯', async function () {
        let scenario = { phases: [{ kind: 'sleep', sec: 1 }] }
        //規則: levels 須為正整數之非空陣列
        await assert.rejects(wss(fdChk, { scenario, levels: [] }), /opt\.levels 須為正整數之非空陣列/)
        await assert.rejects(wss(fdChk, { scenario, levels: [10, 0] }), /opt\.levels 須為正整數之非空陣列/)
        await assert.rejects(wss(fdChk, { scenario, levels: [1.5] }), /opt\.levels 須為正整數之非空陣列/)
    })

    it('指定之 k6 不存在: 拋錯, 不取 session, 不建立結果資料夾', async function () {
        //規則: 指定之 k6 不存在即拋錯
        await assert.rejects(wss(fdChk, { scenario: { phases: [{ kind: 'sleep', sec: 1 }] }, getSessions, k6Path: path.join(fd, 'none.exe') }), /指定之 k6 不存在/)
        assert.equal(called, false)
        assert.ok(!fs.existsSync(fdChk))
    })

    it('指定之 k6 存在但不可執行: 拋錯, 不取 session, 不建立結果資料夾', async function () {
        let fpFake = path.join(fd, 'fake', 'k6.exe')
        fs.mkdirSync(path.dirname(fpFake), { recursive: true })
        fs.writeFileSync(fpFake, 'not an executable', 'utf8')
        //規則: 指定之 k6 須可執行(k6 version), 否則於取 session 前拋錯(不得到施壓時才以未捕捉之例外中止)
        await assert.rejects(wss(fdChk, { scenario: { phases: [{ kind: 'sleep', sec: 1 }] }, getSessions, k6Path: fpFake }), /無法執行 k6/)
        assert.equal(called, false)
        assert.ok(!fs.existsSync(fdChk))
    })

    it('其餘參數格式有誤: 於下載 k6 與取 session 前拋錯並指出欄位', async function () {
        let scenario = { phases: [{ kind: 'sleep', sec: 1 }] }
        let bad = [
            //規則: ramp、dur、gate.timeout 須為 k6 之時間格式(如 30s、3m、1m30s)
            [{ ramp: '30' }, /opt\.ramp/],
            [{ dur: 'abc' }, /opt\.dur/],
            [{ gate: { timeout: '1' } }, /opt\.gate\.timeout/],
            //規則: gate 之門檻須為非負數
            [{ gate: { p95Ms: 'x' } }, /opt\.gate\.p95Ms/],
            [{ gate: { failRate: -1 } }, /opt\.gate\.failRate/],
            //規則: gap 為非負數
            [{ gap: -1 }, /opt\.gap/],
            [{ gap: 'x' }, /opt\.gap/],
            //規則: batchPerHost 為正整數
            [{ batchPerHost: 0 }, /opt\.batchPerHost/],
            [{ batchPerHost: 1.5 }, /opt\.batchPerHost/],
            //規則: procPorts 之值為 1~65535 之整數
            [{ procPorts: { api: 'x' } }, /opt\.procPorts\.api/],
            [{ procPorts: { api: 70000 } }, /opt\.procPorts\.api/],
            //規則: getSessions、releaseSessions、buildScenario 給了則須為函數
            [{ getSessions: [] }, /opt\.getSessions 須為函數/],
            [{ releaseSessions: 1 }, /opt\.releaseSessions 須為函數/],
            [{ buildScenario: {} }, /opt\.buildScenario 須為函數/],
            //規則: label 不含路徑分隔與檔名禁用字元
            [{ label: 'a/b' }, /opt\.label/],
            [{ label: 'a:b' }, /opt\.label/],
            //規則: levels 須為陣列且不得重複
            [{ levels: 10 }, /opt\.levels 須為正整數之非空陣列/],
            [{ levels: [10, 10] }, /opt\.levels 不得重複/],
            //規則: 空字串不當成未給; label 不得過長; fpPending 須為字串
            [{ ramp: '' }, /opt\.ramp/],
            [{ label: 'x'.repeat(101) }, /opt\.label 不得超過 100 字元/],
            [{ fpPending: 5 }, /opt\.fpPending 須為字串/],
        ]
        for (let [o, re] of bad) {
            //k6Path 指向不存在之檔案: 若某項檢核漏了, 會因 k6 不存在而失敗(訊息不符), 不會下載 k6 並真的施壓
            await assert.rejects(wss(fdChk, { scenario, getSessions, k6Path: path.join(fd, 'none.exe'), ...o }), re, JSON.stringify(o))
        }
        assert.equal(called, false)
        assert.ok(!fs.existsSync(fdChk))
    })

})


describe('WScanStress: 實跑', function () {
    this.timeout(180000)

    let demo
    let url
    let logins //getSessions 登入之次數

    let getSessions = async (n) => {
        let ss = []
        for (let i = 0; i < n; i++) {
            let res = await fetch(`${url}/api/login`, { method: 'POST', body: JSON.stringify({ account: 'demo', password: 'demo-pass' }) })
            let j = await res.json()
            logins++
            ss.push({ token: j.msg.token, who: `user${i + 1}` })
        }
        return ss
    }

    let logout = async (ss) => {
        let pending = []
        for (let s of ss) {
            let res = await fetch(`${url}/api/logout`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}` } })
            if (res.status !== 200) pending.push(s)
        }
        return pending
    }

    before(async function () {
        fs.rmSync(fd, { recursive: true, force: true })
        demo = await startDemoServer({ port: 8091 })
        url = demo.url
    })

    after(async function () {
        await demo.close()
        fs.rmSync(fd, { recursive: true, force: true })
        assert.ok(!fs.existsSync(fd))
    })

    beforeEach(function () {
        logins = 0
    })

    it('smoke: session 之代入、二進位本體、計時與停留; 結果檔案、遮蔽與釋放', async function () {
        let auth = { Authorization: 'Bearer {{token}}' }
        let ok = { status: [200], json: [{ path: 'state', equals: 'success' }] }
        let tokens = []
        let r = await wss(fdOut, {
            getSessions: async (n) => {
                let ss = await getSessions(n)
                tokens = ss.map((s) => s.token)
                return ss
            },
            releaseSessions: logout,
            buildScenario: ({ sessions, nVus }) => {
                //規則: buildScenario 傳入 {sessions, nVus}
                assert.equal(nVus, 1)
                assert.equal(sessions.length, 1)
                return {
                    bodies: { q: Buffer.from([1, 2, 3, 4, 5]).toString('base64') },
                    bodiesPerVu: { p: [Buffer.from([1, 2, 3]).toString('base64')] },
                    phases: [
                        {
                            kind: 'requests',
                            name: 'enter',
                            timer: 'enter_page',
                            steps: [
                                [{ name: 'profile', url: `${url}/api/profile`, headers: auth, check: ok }],
                                [
                                    //規則: 共用之二進位本體(5 位元組)原樣送達
                                    { name: 'query', method: 'POST', url: `${url}/api/query`, headers: auth, body: { ref: 'q' }, check: { status: [200], json: [{ path: 'msg.bytes', equals: 5 }] } },
                                    //規則: 各虛擬使用者各自之二進位本體(3 位元組)
                                    { name: 'queryVu', method: 'POST', url: `${url}/api/query`, headers: auth, body: { refPerVu: 'p' }, check: { status: [200], json: [{ path: 'msg.bytes', equals: 3 }] } },
                                    //規則: 文字本體之 {{變數}} 以 session 代入
                                    { name: 'echo', method: 'POST', url: `${url}/api/echo`, headers: auth, body: { text: 'who={{who}}' }, check: { status: [200], json: [{ path: 'msg', equals: 'who=user1' }] } },
                                ],
                            ],
                        },
                        { kind: 'sleep', sec: 1 },
                        { kind: 'stay', name: 'stay', sec: 4, ticks: [{ every: 2, reqs: [{ name: 'poll', url: `${url}/api/poll`, headers: auth, check: ok }] }] },
                    ],
                }
            },
            mode: 'smoke',
            procPorts: { demo: 8091 },
            labels: { enter_page: '進入頁面', demo: '示範服務' },
            meta: { purpose: 'unit' },
            fdTools: path.join(fd, 'tools'),
            k6Path,
            quiet: true,
        })

        //規則: 結果資料夾含 meta.json、smoke/ 之 summary.json、sys.json、k6.log 與 report.txt, 清單檔結束即刪
        assert.deepEqual(ls(r.fdRun), ['meta.json', 'report.txt', 'smoke/k6.log', 'smoke/summary.json', 'smoke/sys.json'])
        //規則: 回傳各級之{vus,code,gate}, 未觸發安全閘
        assert.deepEqual(r.levels, [{ vus: 1, code: 0, gate: false }])
        //規則: 全部釋放
        assert.deepEqual(r.pending, [])
        assert.equal(demo.tokens.size, 0)

        let m = JSON.parse(fs.readFileSync(path.join(r.fdRun, 'smoke', 'summary.json'), 'utf8')).metrics
        //規則: 全部檢核通過(含二進位本體與 {{變數}} 之代入)
        assert.equal(m.checks.values.rate, 1)
        assert.equal(m.app_errors.values.rate, 0)
        //規則: smoke 為 1 位虛擬使用者走 1 趟
        assert.equal(m.iterations.values.count, 1)
        //規則: requests 之各請求各發出 1 次; stay 4 秒每 2 秒發出(第 2、4 秒)共 2 次
        let cnt = (n) => m[`http_req_duration{name:${n}}`].values.count
        assert.deepEqual(['profile', 'query', 'queryVu', 'echo', 'poll'].map(cnt), [1, 1, 1, 1, 2])
        //規則: timer 記錄所需之時間與是否全部成功
        assert.equal(m.enter_page.values.count, 1)
        assert.equal(m.enter_page_ok.values.rate, 1)

        let meta = JSON.parse(fs.readFileSync(path.join(r.fdRun, 'meta.json'), 'utf8'))
        //規則: meta 含情境之摘要、行程與顯示名稱, 附加之 meta 併入
        assert.deepEqual(meta.scenario.names, ['profile', 'query', 'queryVu', 'echo', 'poll'])
        assert.deepEqual(meta.procPorts, { demo: 8091 })
        assert.equal(meta.purpose, 'unit')
        assert.equal(meta.nSessions, 1)
        assert.equal(meta.nReleased, 1)
        //規則: sys.json 記錄指定之行程(依埠找到本程序)
        let sys = JSON.parse(fs.readFileSync(path.join(r.fdRun, 'smoke', 'sys.json'), 'utf8'))
        assert.equal(sys.procBefore.demo.pid, String(process.pid))

        //規則: k6.log 與 meta.json 不含 session 之值
        for (let f of ['meta.json', 'smoke/k6.log', 'report.txt']) {
            let t = fs.readFileSync(path.join(r.fdRun, f), 'utf8')
            for (let tk of tokens) assert.ok(!t.includes(tk), `${f} 含 session 之值`)
        }
        //規則: 報告以顯示名稱列出計時與行程
        assert.ok(r.report.includes('=== 計時 enter_page(進入頁面) ==='))
        assert.ok(r.report.includes('demo(示範服務)'))
        assert.equal(fs.readFileSync(path.join(r.fdRun, 'report.txt'), 'utf8'), r.report)
    })

    it('逐級: 觸發安全閘即不再加壓; 未能釋放之 session 存於 fpPending; meta 函數', async function () {
        let r = await wss(fdOut, {
            getSessions,
            //規則: releaseSessions 回傳未能釋放者(此處故意不登出第 1 個)
            releaseSessions: async (ss) => {
                await logout(ss.slice(1))
                return [ss[0]]
            },
            //規則: 狀態碼 200 而內容不符者計入內容檢核失敗
            scenario: {
                phases: [
                    { kind: 'requests', name: 'fail', steps: [[{ name: 'fail', url: `${url}/api/fail`, headers: { Authorization: 'Bearer {{token}}' }, check: { status: [200], json: [{ path: 'state', equals: 'success' }] } }]] },
                    { kind: 'sleep', sec: 0.5 },
                ],
            },
            levels: [1, 2],
            ramp: '1s',
            dur: '40s',
            gap: 1,
            label: 'gate',
            //規則: meta 可為於取得 session 與情境後產生之函數
            meta: async ({ sessions, scenario }) => ({ nGot: sessions.length, nPhases: scenario.phases.length }),
            //規則: 未能釋放之 session 存於 fpPending
            fpPending: path.join(fd, 'pending', 'p.json'),
            fdTools: path.join(fd, 'tools'),
            k6Path,
            quiet: true,
        })
        //規則: 取 session 之數為最高級之人數
        assert.equal(logins, 2)
        //規則: 任一級觸發安全閘即不再加壓(只跑第 1 級)
        assert.equal(r.levels.length, 1)
        assert.equal(r.levels[0].vus, 1)
        assert.equal(r.levels[0].gate, true)
        assert.notEqual(r.levels[0].code, 0)
        assert.ok(fs.existsSync(path.join(r.fdRun, 'vus001', 'summary.json')))
        assert.ok(!fs.existsSync(path.join(r.fdRun, 'vus002')))
        //規則: 標籤用於結果資料夾之名稱
        assert.ok(/_gate$/.test(path.basename(r.fdRun)))
        //規則: 未能釋放者存於 fpPending(不存於結果資料夾)
        assert.equal(r.pending.length, 1)
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fd, 'pending', 'p.json'), 'utf8')), r.pending)
        assert.ok(!fs.existsSync(path.join(r.fdRun, 'sessions_pending.json')))
        assert.equal(demo.tokens.size, 1)
        //規則: meta 函數之回傳併入 meta.json, 並記錄已釋放之數
        let meta = JSON.parse(fs.readFileSync(path.join(r.fdRun, 'meta.json'), 'utf8'))
        assert.deepEqual([meta.nGot, meta.nPhases, meta.nReleased], [2, 2, 1])
        //規則: 報告標示安全閘之觸發
        assert.ok(/app_errors\s+rate<=0\.05\s+✗ 觸發\(該級已中止\)/.test(r.report))
        //清掉故意留下之令牌
        await logout(r.pending)
        assert.equal(demo.tokens.size, 0)
    })

    it('取得 session 後失敗(情境格式有誤): 仍釋放 session, 原始錯誤不變, 清單檔已刪', async function () {
        let err = await wss(fdOut, {
            getSessions,
            releaseSessions: logout,
            //規則: buildScenario 產生之情境於取得 session 後才檢查, 格式有誤即拋錯
            buildScenario: () => ({ phases: [{ kind: 'x' }] }),
            mode: 'smoke',
            label: 'bad',
            fdTools: path.join(fd, 'tools'),
            k6Path,
            quiet: true,
        }).then(() => null, (e) => e)
        assert.ok(err, '應拋錯')
        assert.match(err.message, /kind 須為 requests、stay 或 sleep/)
        //規則: 取得 session 後任何失敗皆釋放 session
        assert.equal(logins, 1)
        assert.equal(demo.tokens.size, 0)
        //規則: 清單檔(含 session 之值)結束即刪
        let fdRun = path.join(fdOut, fs.readdirSync(fdOut).filter((x) => /_bad$/.test(x))[0])
        assert.ok(!fs.existsSync(path.join(fdRun, '.manifest.json')))
    })

    it('fdOut 為既有之檔案: 於取 session 之前拋錯(結果資料夾於取 session 前建立, 不留下未釋放之 session)', async function () {
        let fpFile = path.join(fd, 'notdir')
        fs.writeFileSync(fpFile, 'x', 'utf8')
        let err = await wss(fpFile, {
            getSessions,
            releaseSessions: logout,
            scenario: { phases: [{ kind: 'sleep', sec: 1 }] },
            mode: 'smoke',
            fdTools: path.join(fd, 'tools'),
            k6Path,
            quiet: true,
        }).then(() => null, (e) => e)
        //規則: 結果資料夾於取session之前建立; 建立失敗時尚未取得session, 故不呼叫getSessions
        assert.ok(err, '應拋錯')
        assert.equal(logins, 0)
        assert.equal(demo.tokens.size, 0)
    })

    it('同分鐘同標籤之並行呼叫: 結果資料夾各自獨立, 不互相覆寫', async function () {
        let mk = () => wss(fdOut, {
            getSessions: async (n) => {
                await new Promise((resolve) => setTimeout(resolve, 300)) //拉長取得session之等待, 使兩次呼叫交錯
                return getSessions(n)
            },
            releaseSessions: logout,
            scenario: { phases: [{ kind: 'sleep', sec: 1 }] },
            mode: 'smoke',
            label: 'same',
            fdTools: path.join(fd, 'tools'),
            k6Path,
            quiet: true,
        })
        let [r1, r2] = await Promise.all([mk(), mk()])
        //規則: 結果資料夾以非遞迴mkdir原子保留, 同標籤者加序號, 並行呼叫不會共用同一夾
        assert.notEqual(r1.fdRun, r2.fdRun)
        for (let r of [r1, r2]) {
            assert.ok(/_same(_\d+)?$/.test(path.basename(r.fdRun)), r.fdRun)
            assert.ok(fs.existsSync(path.join(r.fdRun, 'report.txt')))
            assert.deepEqual(r.levels, [{ vus: 1, code: 0, gate: false }])
        }
        assert.equal(logins, 2)
        assert.equal(demo.tokens.size, 0)
    })

    it('k6.log 含 session 之值(失敗請求之網址): 已遮蔽為 <鍵>, 報告與 meta 亦不含', async function () {
        let tokens = []
        let r = await wss(fdOut, {
            getSessions: async (n) => {
                let ss = await getSessions(n)
                tokens = ss.map((s) => s.token)
                return ss
            },
            releaseSessions: logout,
            //連到本機未監聽之埠(8095), k6 會把含 session 之值的網址寫入 k6.log 之 Request Failed 訊息
            scenario: { phases: [{ kind: 'requests', name: 'refused', steps: [[{ name: 'refused', url: 'http://127.0.0.1:8095/x?token={{token}}' }]] }] },
            mode: 'smoke',
            label: 'mask',
            fdTools: path.join(fd, 'tools'),
            k6Path,
            quiet: true,
        })
        let log = fs.readFileSync(path.join(r.fdRun, 'smoke', 'k6.log'), 'utf8')
        //規則: k6.log 內之 session 之值改為 <鍵>(此處 token= 之後為 <token>, 證明原日誌確有該值且已被遮蔽)
        assert.ok(log.includes('token=<token>'), log)
        for (let f of ['meta.json', 'smoke/k6.log', 'report.txt']) {
            let t = fs.readFileSync(path.join(r.fdRun, f), 'utf8')
            for (let tk of tokens) assert.ok(!t.includes(tk), `${f} 含 session 之值`)
        }
        //規則: 全部請求失敗, 觸發安全閘
        assert.equal(r.levels[0].gate, true)
        assert.equal(demo.tokens.size, 0)
    })

    it('releaseSessions 拋錯: 視為全部未能釋放並存於 fpPending, 不遮蓋原始錯誤', async function () {
        let ss = []
        let fpPending = path.join(fd, 'pending_throw', 'p.json')
        let err = await wss(fdOut, {
            getSessions: async (n) => {
                ss = await getSessions(n)
                return ss
            },
            releaseSessions: async () => {
                throw new Error('logout boom')
            },
            scenario: { phases: [{ kind: 'sleep', sec: 1 }] },
            //meta 函數拋錯: 於清單檔寫入後、k6 執行前失敗
            meta: () => {
                throw new Error('meta boom')
            },
            mode: 'smoke',
            label: 'rel',
            fpPending,
            fdTools: path.join(fd, 'tools'),
            k6Path,
            quiet: true,
        }).then(() => null, (e) => e)
        //規則: try 區塊之原始錯誤不被 releaseSessions 之錯誤遮蓋
        assert.ok(err, '應拋錯')
        assert.match(err.message, /meta boom/)
        //規則: releaseSessions 拋錯視為全部未能釋放, 存於 fpPending(內容為 session 全部)
        assert.deepEqual(JSON.parse(fs.readFileSync(fpPending, 'utf8')), ss)
        //規則: 清單檔結束即刪
        let fdRun = path.join(fdOut, fs.readdirSync(fdOut).filter((x) => /_rel$/.test(x))[0])
        assert.ok(!fs.existsSync(path.join(fdRun, '.manifest.json')))
        //清掉故意留下之令牌
        assert.equal(demo.tokens.size, 1)
        await logout(ss)
        assert.equal(demo.tokens.size, 0)
    })

    it('smoke 純停留之情境: 無請求之報告不出現 null; releaseSessions 回傳非陣列視為全部未能釋放', async function () {
        let r = await wss(fdOut, {
            getSessions,
            //規則: releaseSessions 須回傳未能釋放者之陣列, 非陣列者視為全部未能釋放
            releaseSessions: async () => 'ok',
            scenario: { phases: [{ kind: 'sleep', sec: 1 }] },
            mode: 'smoke',
            label: 'sleep',
            fpPending: path.join(fd, 'pending_sleep', 'p.json'),
            fdTools: path.join(fd, 'tools'),
            k6Path,
            quiet: true,
        })
        assert.equal(r.levels.length, 1)
        assert.equal(r.levels[0].code, 0)
        assert.equal(r.pending.length, 1)
        assert.equal(JSON.parse(fs.readFileSync(path.join(fd, 'pending_sleep', 'p.json'), 'utf8')).length, 1)
        assert.equal(JSON.parse(fs.readFileSync(path.join(r.fdRun, 'meta.json'), 'utf8')).nReleased, 0)
        //規則: 無請求(僅 sleep)之情境, 報告之數值欄位不出現 null
        assert.ok(!/\bnull\b/.test(r.report), r.report)
        await logout(r.pending)
        assert.equal(demo.tokens.size, 0)
    })

    it('getSessions 回傳空陣列或非物件之元素: 拋錯, 並移除預先建立之空結果資料夾', async function () {
        for (let [v, re, label] of [[[], /opt\.getSessions 須回傳非空陣列/, 'empty'], [[null], /opt\.getSessions 須回傳 session 物件之陣列/, 'nullitem'], [['abc'], /須回傳 session 物件之陣列/, 'stritem']]) {
            await assert.rejects(wss(fdOut, {
                //規則: getSessions 須回傳非空之 session 物件陣列
                getSessions: async () => v,
                scenario: { phases: [{ kind: 'sleep', sec: 1 }] },
                mode: 'smoke',
                label,
                fdTools: path.join(fd, 'tools'),
                k6Path,
                quiet: true,
            }), re)
            //規則: 失敗時預先建立之結果資料夾(尚無任何檔案)已移除
            assert.equal(fs.readdirSync(fdOut).filter((x) => x.endsWith(`_${label}`)).length, 0, label)
        }
    })

    it('getSessions 拋錯: 原錯誤保留, 預先建立之空結果資料夾已移除', async function () {
        let err = await wss(fdOut, {
            getSessions: async () => {
                throw new Error('login failed')
            },
            scenario: { phases: [{ kind: 'sleep', sec: 1 }] },
            mode: 'smoke',
            label: 'getfail',
            fdTools: path.join(fd, 'tools'),
            k6Path,
            quiet: true,
        }).then(() => null, (e) => e)
        assert.match(err.message, /login failed/)
        assert.equal(fs.readdirSync(fdOut).filter((x) => x.endsWith('_getfail')).length, 0)
    })

})
