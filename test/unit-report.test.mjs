//
// unit: 文字報告(src/report.mjs 之 buildReport 與其輔助函數), 以 test/fixtures/run 之結果(1 級 10 人)為輸入
//
// 對應規則(src/report.mjs 之說明, README 之〈報告與對照〉):
//   分組取自彙總之 http_req_duration{name:<分組>}, 計時取自有 <計時>_ok 之 Trend, 行程取自 meta.json 之 procPorts, 顯示名稱取 meta.json 之 labels;
//   分組依情境(meta.scenario.names)之順序; 各分組 p95 達 nameP95Ms 者標 ✗; 本次未發出之分組標示;
//   行程之處理器使用率為該級期間累計處理器時間之增量除以秒數(以單核為 100%), 前後 PID 不同(行程重啟)者不計;
//   失敗之檢核依 root_group 逐層列出; k6.log 之失敗請求依型態(網址與位址歸一)與逐秒分佈統計;
//   輸入單一 summary.json 時只列該結果之明細
//
import { strict as assert } from 'assert'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { buildReport, namesOf, timersOf, failedChecks, failStat, cpuOf, loadLevel } from '../src/report.mjs'


let fdRun = path.resolve('./test/fixtures/run')
let fdLevel = path.join(fdRun, 'vus010')


//snapshot, 資料夾內全部檔案(遞迴, 相對路徑)與其內容之 sha256
let snapshot = (dir) => {
    let out = {}
    let walk = (d) => {
        for (let ent of fs.readdirSync(d, { withFileTypes: true })) {
            let p = path.join(d, ent.name)
            if (ent.isDirectory()) {
                walk(p)
            }
            else {
                out[path.relative(dir, p).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
            }
        }
    }
    walk(dir)
    return out
}
let snap0 = snapshot(fdRun) //於任何報告函數執行之前取得


describe('report: 輔助函數', function () {

    let L = loadLevel(fdLevel)

    it('loadLevel: 讀 summary.json、sys.json 與 k6.log; 無 summary.json 回傳 null', function () {
        //規則: 回傳{fd,data,m,sys,fpLog}
        assert.equal(L.fd, fdLevel)
        assert.equal(L.sys.sec, 100)
        assert.equal(L.fpLog, path.join(fdLevel, 'k6.log'))
        //規則: 無summary.json則回傳null
        assert.equal(loadLevel(fdRun), null)
    })

    it('namesOf、timersOf: 分組取自 http_req_duration{name:*}, 計時取自有 _ok 者', function () {
        //規則: 分組名稱(http_req_duration{name:<分組>})
        assert.deepEqual(namesOf(L.m).sort(), ['list', 'poll', 'profile', 'query'])
        //規則: 計時名稱(有<計時>_ok之Trend)
        assert.deepEqual(timersOf(L.m), ['enter_page'])
    })

    it('failedChecks: 依 root_group 逐層列出失敗者', function () {
        //規則: 只列fails大於0者, 含所在之group
        assert.deepEqual(failedChecks(L.data), [{ group: 'enter', name: 'list 成功', passes: 18, fails: 2 }])
        //規則: 無root_group者為空
        assert.deepEqual(failedChecks({}), [])
    })

    it('failStat: 失敗請求之筆數、首次、型態(網址與位址歸一)與逐秒分佈', function () {
        let r = failStat(L.fpLog)
        //規則: 筆數與首次發生之時點
        assert.equal(r.n, 3)
        assert.equal(r.first, '0m20.0s (10/10 VUs)')
        //規則: 逐秒分佈
        assert.deepEqual(r.kp, { '0m20.0s': 2, '0m21.0s': 1 })
        //規則: 型態之網址與位址歸一(不同網址之拒絕連線歸為同一型態)
        assert.deepEqual(r.kinds, {
            'Get <網址>: dial tcp <位址>: connectex: No connection could be made because the target machine actively refused it.': 2,
            'Get <網址>: request timeout': 1,
        })
        //規則: 無檔案則回傳null
        assert.equal(failStat(''), null)
    })

    it('cpuOf: 累計處理器時間之增量除以秒數, 前後 PID 不同者不計', function () {
        //規則: (20 - 10) / 100 秒 = 10%
        assert.equal(cpuOf(L.sys, 'api'), 10)
        //規則: 前後PID不同(行程重啟)者不計
        assert.equal(cpuOf(L.sys, 'auth'), null)
        //規則: 無資源記錄者不計
        assert.equal(cpuOf(null, 'api'), null)
        //規則: 該級秒數非正數(無法求使用率)者不計, 不得得到Infinity或NaN
        assert.equal(cpuOf({ ...L.sys, sec: 0 }, 'api'), null)
        assert.equal(cpuOf({ ...L.sys, sec: undefined }, 'api'), null)
    })

    it('cpuOf: 查詢監聽行程失敗({error})者不計, 不得得到 NaN', function () {
        let ok = L.sys.procBefore.api
        let er = { error: 'port[8000] listener query failed: powershell timeout[10000ms]' }
        //規則: 前後任一次為查詢監聽行程失敗(error)者不計(兩次皆失敗時前後PID同為undefined, 仍不得算出NaN)
        assert.equal(cpuOf({ sec: 100, procBefore: { api: er }, procAfter: { api: er } }, 'api'), null)
        assert.equal(cpuOf({ sec: 100, procBefore: { api: er }, procAfter: { api: ok } }, 'api'), null)
        assert.equal(cpuOf({ sec: 100, procBefore: { api: ok }, procAfter: { api: er } }, 'api'), null)
    })

})


describe('report: buildReport', function () {

    let txt = buildReport(fdRun)
    let lines = txt.split('\n')
    let sec = (title) => {
        let i = lines.findIndex((s) => s.startsWith(title))
        assert.ok(i >= 0, `找不到段落: ${title}`)
        let j = lines.findIndex((s, k) => k > i && s.startsWith('==='))
        return lines.slice(i, j < 0 ? lines.length : j)
    }

    it('參數與情境之摘要', function () {
        //規則: 逐級時列爬升、持續與級間休息
        assert.ok(txt.includes('參數: mode=level 每級爬升 30s + 持續 3m; 級間休息 30s; k6 k6.exe v2.3.0'))
        //規則: 情境之各階段與請求數
        assert.ok(txt.includes('情境: requests(enter) 3 個請求 → stay(stay) 1 個請求'))
    })

    it('各級總覽: 行程欄取自 procPorts, PID 變動者為 -', function () {
        let s = sec('=== 各級總覽 ===')
        //規則: 行程取自meta.json之procPorts
        assert.ok(/\bapi\b/.test(s[1]) && /\bauth\b/.test(s[1]))
        //規則: 該級之列(10人): req/s、完成趟、失敗率、整機處理器平均/最高、各行程處理器
        let row = s.find((x) => x.startsWith('10人'))
        assert.ok(row, s.join('\n'))
        let cells = row.trim().split(/\s+/)
        assert.deepEqual(cells, ['10人', '0.8', '20', '1.25%', '0.00%', '98.57%', '239ms', '2.65s', '20%/30%', '10%', '-'])
    })

    it('計時: 標題附顯示名稱, 列全部成功比例與 p95、max', function () {
        let s = sec('=== 計時 enter_page(進入頁面) ===')
        let cells = s.find((x) => x.startsWith('10人')).trim().split(/\s+/)
        //規則: 次數、全部成功(<計時>_ok)、med、p90、p95、max
        assert.deepEqual(cells, ['10人', '20', '90.00%', '748ms', '773ms', '783ms', '1.80s'])
    })

    it('各分組 p95: 依情境之順序, 達門檻標 ✗, 未發出為 -, 附顯示名稱', function () {
        let s = sec('=== 各分組 p95')
        //規則: 門檻取meta.gate.nameP95Ms
        assert.ok(s[0].includes('✗ 為超過 2.00s'))
        let rows = s.slice(2).filter((x) => x.trim())
        //規則: 依情境(meta.scenario.names)之順序
        assert.deepEqual(rows.map((x) => x.trim().split(/\s+/)[0]), ['profile', 'list', 'query', 'poll'])
        //規則: 達門檻者標✗, 附顯示名稱
        assert.deepEqual(rows[1].trim().split(/\s+/), ['list', '2.50s✗', '取清單'])
        //規則: 本次未發出者為-
        assert.deepEqual(rows[2].trim().split(/\s+/), ['query', '-'])
    })

    it('各級明細: 行程之處理器與記憶體、門檻、安全閘、失敗之檢核、失敗請求', function () {
        let i = lines.findIndex((s) => s.startsWith('--- 10人 ---'))
        let d = lines.slice(i).join('\n')
        //規則: 行程以顯示名稱列出, PID變動者處理器為-
        assert.ok(d.includes('各行程CPU(單核%): api(主服務) 10%、auth -'))
        assert.ok(d.includes('各行程記憶體(MB, 前→後): api(主服務) 500→520、auth 100→110'))
        //規則: 計時之明細
        assert.ok(d.includes('計時 enter_page(進入頁面): 20 次, 全部成功 90.00%'))
        //規則: 分組之門檻未過者標超標
        assert.ok(/list\s+20\s+900ms\s+800ms\s+2\.20s\s+2\.50s\s+2\.65s\s+p\(95\)<2000 ✗ 超標\s+取清單/.test(d))
        //規則: 本次未發出之分組
        assert.ok(/query\s+\(本次未發出\)/.test(d))
        //規則: 安全閘之狀態
        assert.ok(/http_req_failed\s+rate<0\.05\s+✓ 未觸發/.test(d))
        //規則: 失敗之檢核依root_group列出
        assert.ok(d.includes('enter / list 成功: 失敗 2、成功 18'))
        //規則: 失敗請求之筆數與型態
        assert.ok(d.includes('失敗請求(k6 log): 3  首次於 0m20.0s (10/10 VUs)'))
        assert.ok(/型態 2 筆\s+Get <網址>: dial tcp <位址>/.test(d))
    })

    it('單一 summary.json: 只列該結果之明細(無 meta 之顯示名稱)', function () {
        let t = buildReport(path.join(fdLevel, 'summary.json'), { fpLog: path.join(fdLevel, 'k6.log') })
        //規則: 輸入單一summary.json時列檔案與明細
        assert.ok(t.startsWith('檔案: '))
        assert.ok(t.includes('--- 結果 ---'))
        assert.ok(!t.includes('=== 各級總覽 ==='))
        //規則: 給opt.fpLog時統計失敗請求
        assert.ok(t.includes('失敗請求(k6 log): 3'))
        //規則: 無meta.json時不附顯示名稱
        assert.ok(t.includes('計時 enter_page: 20 次'))
    })

    it('opt.labels 覆寫 meta.json 之顯示名稱', function () {
        let t = buildReport(fdRun, { labels: { enter_page: '進站' } })
        //規則: opt.labels預設取meta.json之labels, 給予則覆寫
        assert.ok(t.includes('=== 計時 enter_page(進站) ==='))
        assert.ok(!t.includes('取清單'))
    })

    it('資源取樣皆成功時, 不出現查詢監聽行程失敗之列', function () {
        //規則: 只在有查詢監聽行程失敗({error})時才列出
        assert.ok(!txt.includes('查詢監聽行程失敗'))
    })

    it('fixtures 未被改動', function () {
        //報告為唯讀: 不寫入結果資料夾(檔案清單與內容雜湊皆與呼叫前相同; 呼叫前之快照於本檔載入時取得)
        assert.deepEqual(snapshot(fdRun), snap0)
        assert.deepEqual(fs.readdirSync(fdRun).sort(), ['meta.json', 'vus010'])
    })

})


describe('report: 查詢監聽行程失敗', function () {

    let fd = path.resolve('./test/_tmp/report-procerr')
    let msg = 'port[8000] listener query failed: netstat none(not trusted alone), powershell timeout[10000ms]'

    before(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.cpSync(fdRun, fd, { recursive: true })
        //api: 施壓前查詢失敗、施壓後成功; auth: 前後皆失敗(原因相同)
        let sys = JSON.parse(fs.readFileSync(path.join(fd, 'vus010', 'sys.json'), 'utf8'))
        sys.procBefore = { api: { error: msg }, auth: { error: msg } }
        sys.procAfter = { api: sys.procAfter.api, auth: { error: msg } }
        fs.writeFileSync(path.join(fd, 'vus010', 'sys.json'), JSON.stringify(sys), 'utf8')
    })

    after(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        assert.ok(!fs.existsSync(fd))
    })

    it('明細列出失敗之行程與原因, 該行程之處理器與記憶體欄為 -(不是 NaN), 總覽欄亦為 -', function () {
        let t = buildReport(fd)
        let i = t.split('\n').findIndex((s) => s.startsWith('--- 10人 ---'))
        let d = t.split('\n').slice(i).join('\n')
        //規則: 查詢監聽行程失敗者須列出(與無人監聽之 - 區分), 附失敗原因
        assert.ok(d.includes(`施壓前查詢監聽行程失敗(資源欄為 -) api: ${msg}`), d)
        assert.ok(d.includes(`施壓前查詢監聽行程失敗(資源欄為 -) auth: ${msg}`), d)
        assert.ok(d.includes(`施壓後查詢監聽行程失敗(資源欄為 -) auth: ${msg}`), d)
        //規則: 施壓後成功者不列
        assert.ok(!d.includes('施壓後查詢監聽行程失敗(資源欄為 -) api'), d)
        //規則: 該行程之處理器與記憶體欄為-
        assert.ok(d.includes('各行程CPU(單核%): api(主服務) -、auth -'), d)
        assert.ok(d.includes('各行程記憶體(MB, 前→後): api(主服務) -、auth -'), d)
        assert.ok(!/NaN|undefined/.test(t), t)
        let row = t.split('\n').find((x) => x.startsWith('10人'))
        assert.deepEqual(row.trim().split(/\s+/).slice(-2), ['-', '-'])
    })

})


describe('report: 無請求或無結果', function () {

    let fd = path.resolve('./test/_tmp/report')

    before(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(path.join(fd, 'smoke'), { recursive: true })
        fs.mkdirSync(path.join(fd, 'none'), { recursive: true })
        //僅 sleep 之情境: 彙總內沒有 http_reqs、checks 等指標
        fs.writeFileSync(path.join(fd, 'smoke', 'summary.json'), JSON.stringify({ metrics: { iterations: { values: { count: 1, rate: 0.9 } } } }), 'utf8')
    })

    after(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        assert.ok(!fs.existsSync(fd))
    })

    it('彙總無請求類指標: 數值欄位為 0, 不出現 null', function () {
        let t = buildReport(path.join(fd, 'smoke', 'summary.json'))
        //規則: 無請求之情境, 請求總數、checks通過數等以0列出
        assert.ok(t.includes('請求總數      : 0  ( 0.0 req/s )'), t)
        assert.ok(t.includes('checks 通過率 : 0.00% ( 0 / 0 )'), t)
        assert.ok(!/\bnull\b|undefined/.test(t), t)
    })

    it('failStat: 失敗請求早於任何進度行時, 首次不出現空值', function () {
        let fp = path.join(fd, 'early.log')
        fs.writeFileSync(fp, 'time="2026-10-18T19:12:20+08:00" level=warning msg="Request Failed" error="Get \\"http://127.0.0.1:1/x\\": timeout"\n', 'utf8')
        let r = failStat(fp)
        //規則: 失敗請求早於任何進度行(無時點與VU數)時, 首次以(進度行之前)表示
        assert.equal(r.n, 1)
        assert.equal(r.first, '(進度行之前)')
    })

    it('資料夾內無任何一級之彙總: 報告註明並指向 k6.log', function () {
        let t = buildReport(fd)
        //規則: 有 smoke 之彙總者照列
        assert.ok(t.includes('=== 各級總覽 ==='))
        assert.ok(/^smoke\s/m.test(t), t)
        let t2 = buildReport(path.join(fd, 'none'))
        //規則: 無任何一級之彙總時註明, 不留空白報告
        assert.ok(t2.includes('無任何一級之彙總(summary.json), 請查看各級資料夾內之 k6.log'), t2)
    })

})


describe('report: 級距不完整、損毀與排序', function () {

    let fd = path.resolve('./test/_tmp/report2')

    //put, 將 fixtures 之 vus010 複製為指定級距資料夾
    let put = (name) => {
        fs.cpSync(fdLevel, path.join(fd, name), { recursive: true })
        return path.join(fd, name)
    }

    beforeEach(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
        fs.copyFileSync(path.join(fdRun, 'meta.json'), path.join(fd, 'meta.json'))
    })

    after(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        assert.ok(!fs.existsSync(fd))
    })

    it('loadLevel: summary.json 或 sys.json 損毀', function () {
        let lv = put('vus010')
        fs.writeFileSync(path.join(lv, 'summary.json'), '{"metrics": {', 'utf8')
        //規則: summary.json損毀(如k6被中斷而寫入不完整)視為無結果, 回傳null
        assert.equal(loadLevel(lv), null)
        fs.copyFileSync(path.join(fdLevel, 'summary.json'), path.join(lv, 'summary.json'))
        fs.writeFileSync(path.join(lv, 'sys.json'), 'xx', 'utf8')
        //規則: sys.json損毀視為無資源記錄
        let L = loadLevel(lv)
        assert.equal(L.sys, null)
        assert.ok(L.m.http_reqs)
    })

    it('某級無彙總或彙總損毀: 仍列出該級並指向 k6.log, 其餘級照列, 不拋錯', function () {
        put('vus010')
        let lv = put('vus020')
        fs.writeFileSync(path.join(lv, 'summary.json'), '{"metrics": {', 'utf8')
        let lv3 = put('vus030')
        fs.rmSync(path.join(lv3, 'summary.json'))
        let t = buildReport(fd)
        //規則: 無有效彙總之級(不存在或損毀)不得被隱去, 註明並指向該級之k6.log; 不得因損毀之JSON而拋錯
        assert.ok(t.includes('(20人 無有效之彙總(summary.json 不存在或損毀), 未列入下列各表, 請查看 vus020/k6.log)'), t)
        assert.ok(t.includes('(30人 無有效之彙總'), t)
        //規則: 有彙總之級照列
        assert.ok(/^10人\s/m.test(t), t)
        assert.ok(!/^20人\s/m.test(t))
    })

    it('級距依人數(數值)排序, 非字串順序', function () {
        put('vus200')
        put('vus1000')
        put('vus050')
        let t = buildReport(fd)
        let s = t.split('\n')
        let i = s.findIndex((x) => x.startsWith('=== 各級總覽 ==='))
        let j = s.findIndex((x, k) => k > i && x.startsWith('==='))
        let rows = s.slice(i, j).filter((x) => /^\d+人\s/.test(x)).map((x) => x.split(/\s+/)[0])
        //規則: 級距依人數數值由小至大(vus1000 在 vus200 之後)
        assert.deepEqual(rows, ['50人', '200人', '1000人'])
        let titles = t.split('\n').filter((s) => s.startsWith('--- ')).map((s) => s.replace(/-/g, '').trim())
        assert.deepEqual(titles, ['50人', '200人', '1000人'])
    })

    it('gate.nameP95Ms 為 0: 視為有效門檻, 總表與明細一致', function () {
        put('vus010')
        let meta = JSON.parse(fs.readFileSync(path.join(fd, 'meta.json'), 'utf8'))
        meta.gate.nameP95Ms = 0
        fs.writeFileSync(path.join(fd, 'meta.json'), JSON.stringify(meta), 'utf8')
        let t = buildReport(fd)
        //規則: 0為有效門檻, 不得當成缺值而改用預設(2000ms)
        assert.ok(t.includes('✗ 為超過 0ms'), t)
        let s = t.split('\n')
        let i = s.findIndex((x) => x.startsWith('=== 各分組 p95'))
        let rows = s.slice(i + 2).filter((x) => x.trim()).slice(0, 4)
        //規則: p95大於門檻者標✗(profile 之 p95 大於 0)
        let cells = (n) => rows.find((x) => x.trim().startsWith(n)).trim().split(/\s+/)
        assert.ok(cells('profile')[1].endsWith('✗'), rows.join('\n'))
        assert.ok(cells('list')[1].endsWith('✗'), rows.join('\n'))
    })

    it('門檻邊界: p95 恰等於門檻不標 ✗', function () {
        put('vus010')
        let meta = JSON.parse(fs.readFileSync(path.join(fd, 'meta.json'), 'utf8'))
        let sm = JSON.parse(fs.readFileSync(path.join(fd, 'vus010', 'summary.json'), 'utf8'))
        meta.gate.nameP95Ms = sm.metrics['http_req_duration{name:list}'].values['p(95)']
        fs.writeFileSync(path.join(fd, 'meta.json'), JSON.stringify(meta), 'utf8')
        let t = buildReport(fd)
        let s = t.split('\n')
        let i = s.findIndex((x) => x.startsWith('=== 各分組 p95'))
        let row = s.slice(i + 2).find((x) => x.trim().startsWith('list'))
        //規則: 「超過」門檻才標✗, 恰等於不標(與k6門檻 p(95)<=上限 一致)
        assert.ok(!row.includes('✗'), row)
    })

})
