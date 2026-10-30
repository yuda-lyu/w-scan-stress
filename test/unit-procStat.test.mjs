//
// unit: 資源記錄(src/procStat.mjs), 以本測試程序及其監聽之埠(8093)為對象
//
// 對應規則(src/procStat.mjs 之說明, README 之〈設計〉procPorts, sgud/rule/rulebook.md 之 R15):
//   pidOfPort: 經 wsemi 之 execProcessPortPidsSync 取監聽指定埠之行程 PID 陣列(數字、由小到大);
//              判定不依 netstat 之狀態欄(本機 OS 之 TCP 狀態值有錯置, netstat 亦會漏列新起之監聽: 漏列時以 Get-NetTCPConnection 確認);
//              空陣列只代表已確認無人監聽, 查詢失敗與埠號不合法一律拋錯, 不以空陣列代替
//   procStat: 以 tasklist 取行程之記憶體(MB)與累計處理器時間(秒), 取不到為 null
//   snapProcs: 依行程鍵名對埠號取各行程之資源; 無人監聽為 null, 查詢監聽者失敗為 { error }; 多個行程監聽同一埠取 PID 最小者
//   listSnapErrors: 列出查詢監聽者失敗之行程
//   startSampler: 每秒取樣整機處理器使用率與記憶體, 停止後不再取樣
//
import { strict as assert } from 'assert'
import net from 'net'
import { pidOfPort, procStat, snapProcs, listSnapErrors, startSampler } from '../src/procStat.mjs'
import { row, ns, BG, ps, ok, err, fakeExec } from './tools/portExec.mjs'


describe('procStat', function () {
    this.timeout(30000)

    let srv
    let port = 8093
    let portFree //確定沒有行程監聽之埠(取得一個空閒埠後即關閉)

    before(async function () {
        srv = net.createServer()
        await new Promise((resolve, reject) => {
            srv.once('error', reject)
            srv.listen(port, '127.0.0.1', resolve)
        })
        let tmp = net.createServer()
        await new Promise((resolve) => tmp.listen(0, '127.0.0.1', resolve))
        portFree = tmp.address().port
        await new Promise((resolve) => tmp.close(resolve))
    })

    after(async function () {
        await new Promise((resolve) => srv.close(resolve))
    })


    describe('pidOfPort: 以替身(spawnSync 形)注入 netstat 與 Get-NetTCPConnection 之輸出', function () {
        let P = 8080
        let run = (outs) => {
            let calls = []
            let pids = pidOfPort(P, { platform: 'win32', exec: fakeExec(outs, calls) })
            return { pids, calls }
        }

        it('netstat 有列: 回傳 PID 數字陣列, 不再查 Get-NetTCPConnection', function () {
            let r = run({ netstat: ok(ns([...BG, row('TCP', '0.0.0.0:8080', '0.0.0.0:0', 'LISTENING', '1111')])) })
            //規則: 回傳PID數字陣列
            assert.deepEqual(r.pids, [1111])
            //規則: netstat 有查到即採用(不查 Get-NetTCPConnection)
            assert.deepEqual(r.calls, ['netstat'])
        })

        it('狀態錯置: 狀態欄為 FIN_WAIT_1、CLOSED 或缺欄之監聽列, 仍判為監聽(不依狀態欄)', function () {
            for (let st of ['FIN_WAIT_1', 'CLOSED', 'ESTABLISHED', null]) {
                let r = run({ netstat: ok(ns([...BG, row('TCP', '0.0.0.0:8080', '0.0.0.0:0', st, '1111')])) })
                //規則: 判定不依netstat之狀態欄
                assert.deepEqual(r.pids, [1111], `state=${st}`)
                assert.deepEqual(r.calls, ['netstat'], `state=${st}`)
            }
        })

        it('狀態錯置: 進入或對外之連線反列 LISTENING 者不是監聽(遠端非萬用位址), 不得回傳其 PID', function () {
            let r = run({
                netstat: ok(ns([
                    ...BG,
                    //本地埠 8080 之進入連線(遠端為對端位址)被標為 LISTENING
                    row('TCP', '10.0.0.5:8080', '10.0.0.9:50000', 'LISTENING', '7000'),
                    //對外連線至遠端 :8080 被標為 LISTENING
                    row('TCP', '10.0.0.5:51000', '10.0.0.9:8080', 'LISTENING', '7001'),
                ])),
                powershell: ok(ps([])),
            })
            //規則: 以遠端位址為萬用位址(且遠端埠0)判定監聽, 不以狀態欄; 無人監聽時為[]
            assert.deepEqual(r.pids, [])
            assert.deepEqual(r.calls, ['netstat', 'powershell'])
        })

        it('netstat 漏列新起之監聽: 改以 Get-NetTCPConnection 確認而查得', function () {
            //netstat 他埠有列、目標埠整列缺漏(本機實測之異常形)
            let r = run({ netstat: ok(ns(BG)), powershell: ok(ps([[8080, '0.0.0.0', 0, 1111]])) })
            //規則: netstat 查無時以 Get-NetTCPConnection 確認, 查得即回傳其 PID
            assert.deepEqual(r.pids, [1111])
            assert.deepEqual(r.calls, ['netstat', 'powershell'])
        })

        it('兩者皆查無: 回傳空陣列(已確認無人監聽)', function () {
            let r = run({ netstat: ok(ns(BG)), powershell: ok(ps([])) })
            //規則: 空陣列只代表已確認無人監聽
            assert.deepEqual(r.pids, [])
        })

        it('netstat 失敗(指令不存在): 仍以 Get-NetTCPConnection 之結果為準', function () {
            let r = run({ netstat: err('ENOENT'), powershell: ok(ps([[8080, '::', 0, 2222]])) })
            assert.deepEqual(r.pids, [2222])
            assert.deepEqual(r.calls, ['netstat', 'powershell'])
        })

        it('查詢失敗: Get-NetTCPConnection 逾時或失敗而 netstat 查無, 拋錯而非回傳空陣列', function () {
            //規則: 查詢失敗一律拋錯, 不以空陣列代表(失敗不得與無人監聽混淆); 訊息為失敗原因
            assert.throws(() => run({ netstat: ok(ns(BG)), powershell: err('ETIMEDOUT') }), /powershell timeout/)
            assert.throws(() => run({ netstat: ok(ns(BG)), powershell: err('ENOENT') }), /powershell error\[ENOENT\]/)
            assert.throws(() => run({ netstat: ok(ns(BG)), powershell: ok('', 3) }), /powershell code\[3\]/)
            //兩者皆失敗
            assert.throws(() => run({ netstat: err('ENOENT'), powershell: err('ENOENT') }), /netstat error\[ENOENT\].*powershell error\[ENOENT\]/)
        })

        it('多個行程監聽同一埠: 回傳全部 PID(去重, 數字, 由小到大)', function () {
            let r = run({
                netstat: ok(ns([
                    ...BG,
                    row('TCP', '0.0.0.0:8080', '0.0.0.0:0', 'LISTENING', '2222'),
                    row('TCP', '[::]:8080', '[::]:0', 'LISTENING', '1111'),
                    row('TCP', '127.0.0.1:8080', '0.0.0.0:0', 'LISTENING', '2222'),
                ])),
            })
            assert.deepEqual(r.pids, [1111, 2222])
        })

        it('埠號須為 1~65535 之整數(Number): 其餘拋錯且不執行任何子指令', function () {
            for (let v of [undefined, null, '8080', '80.3', '8093|1', '', 0, 65536, 1.5, -1, NaN, Infinity, [8080], {}]) {
                let calls = []
                //規則: 埠號須為整數, 其他值不合法(不將其組入子指令), 不合法為拋錯而非空陣列
                assert.throws(() => pidOfPort(v, { platform: 'win32', exec: fakeExec({}, calls) }), /port/, String(v))
                assert.deepEqual(calls, [], String(v))
            }
        })
    })


    describe('pidOfPort: 真實監聽與真實查詢失敗', function () {
        it('取監聽指定埠之行程; 無人監聽為空陣列', function () {
            //規則: 回傳監聽指定埠之行程PID(數字陣列); 本機 OS 之 netstat 不列出新起之監聽, 仍須查得
            assert.deepEqual(pidOfPort(port), [process.pid])
            //規則: 已確認無人監聽則回傳[]
            assert.deepEqual(pidOfPort(portFree), [])
        })

        it('取得其他介面(0.0.0.0、::)之監聽者', async function () {
            for (let host of ['0.0.0.0', '::']) {
                let s = net.createServer()
                await new Promise((resolve, reject) => {
                    s.once('error', reject)
                    s.listen(0, host, resolve)
                })
                try {
                    //規則: 不論監聽之位址族, 查得監聽該埠之行程
                    assert.deepEqual(pidOfPort(s.address().port), [process.pid], host)
                }
                finally {
                    await new Promise((resolve) => s.close(resolve))
                }
            }
        })

        it('查詢失敗(系統資料夾不存在, netstat 與 PowerShell 皆無法啟動): 拋錯而非回傳空陣列', function () {
            let sysRoot = process.env.SystemRoot
            process.env.SystemRoot = 'Z:\\__no_such_system_root__'
            try {
                //規則: 查詢失敗一律拋錯, 不以空陣列代表
                assert.throws(() => pidOfPort(port), /listener query failed/)
            }
            finally {
                process.env.SystemRoot = sysRoot
            }
            //還原後恢復正常
            assert.deepEqual(pidOfPort(port), [process.pid])
        })
    })


    it('procStat: 記憶體與累計處理器時間; 無此行程為 null', function () {
        let r = procStat(String(process.pid))
        //規則: 回傳{pid,memMb,cpuSec}
        assert.equal(r.pid, String(process.pid))
        assert.ok(r.memMb > 0, JSON.stringify(r))
        assert.ok(r.cpuSec >= 0, JSON.stringify(r))
        //規則: 取不到則回傳null
        assert.equal(procStat(''), null)
        assert.equal(procStat('99999999'), null)
    })


    describe('snapProcs', function () {
        it('依鍵名對埠號取各行程之資源: 無人監聽為 null, 查詢失敗為 { error }(兩者不同), 鍵名順序不變', function () {
            //各鍵依序查詢: a(netstat 有列)、b(netstat 漏列且 Get-NetTCPConnection 無)、c(netstat 漏列且 Get-NetTCPConnection 逾時)
            let nPs = 0
            let exec = fakeExec({
                netstat: ok(ns([...BG, row('TCP', '0.0.0.0:8001', '0.0.0.0:0', 'LISTENING', String(process.pid))])),
                get powershell() {
                    nPs++
                    return nPs === 1 ? ok(ps([])) : err('ETIMEDOUT')
                },
            })
            let r = snapProcs({ a: 8001, b: 8002, c: 8003 }, { platform: 'win32', exec })
            //規則: 回傳行程鍵名對{pid,memMb,cpuSec}之物件
            assert.deepEqual(Object.keys(r), ['a', 'b', 'c'])
            assert.equal(r.a.pid, String(process.pid))
            assert.ok(r.a.memMb > 0, JSON.stringify(r.a))
            //規則: 無人監聽該埠者為null
            assert.equal(r.b, null)
            //規則: 查詢監聽者失敗者為{error}(失敗原因字串), 不與無人監聽混淆
            assert.equal(typeof r.c.error, 'string')
            assert.match(r.c.error, /powershell timeout/)
            assert.deepEqual(Object.keys(r.c), ['error'])
        })

        it('埠號不合法者記為 { error }, 不拋出', function () {
            let r = snapProcs({ x: 'abc' })
            //規則: 查詢失敗(含埠號不合法)記錄於該鍵, 不使整次取樣中斷
            assert.match(r.x.error, /port/)
        })

        it('同一埠多個行程監聽: 取 PID 最小者', function () {
            let big = process.pid + 100000
            let exec = fakeExec({
                netstat: ok(ns([
                    row('TCP', '0.0.0.0:8001', '0.0.0.0:0', 'LISTENING', String(big)),
                    row('TCP', '[::]:8001', '[::]:0', 'LISTENING', String(process.pid)),
                ])),
            })
            let r = snapProcs({ a: 8001 }, { platform: 'win32', exec })
            //規則: 同一埠有多個行程監聽時取PID最小者
            assert.equal(r.a.pid, String(process.pid))
        })

        it('真實監聽: 找到本程序之資源; 無人監聽為 null', function () {
            let r = snapProcs({ self: port, none: portFree })
            //規則: 回傳行程鍵名對{pid,memMb,cpuSec}之物件, 無人監聽者為null
            assert.equal(r.self.pid, String(process.pid))
            assert.equal(r.none, null)
        })
    })


    it('listSnapErrors: 列出查詢監聽者失敗之行程(「鍵名: 原因」); 無則為空陣列', function () {
        //規則: 只列{error}者, 不列null(無人監聽)與正常取樣
        assert.deepEqual(listSnapErrors({ a: { error: 'x y' }, b: null, c: { pid: '1', memMb: 1, cpuSec: 0 }, d: { error: 'z' } }), ['a: x y', 'd: z'])
        //規則: 無資料(含舊格式之空值)為空陣列
        assert.deepEqual(listSnapErrors({}), [])
        assert.deepEqual(listSnapErrors(null), [])
        assert.deepEqual(listSnapErrors(undefined), [])
    })

    it('startSampler: 每秒取樣整機處理器與記憶體, 停止後不再取樣', async function () {
        let stop = startSampler()
        await new Promise((resolve) => setTimeout(resolve, 2300))
        let samples = stop()
        //規則: 每秒取樣一次(2.3 秒內預期 2 筆; 事件迴圈繁忙時計時器可能合併, 故至少 1 筆)
        assert.ok(samples.length >= 1, `samples=${samples.length}`)
        for (let s of samples) {
            //規則: 取樣含時間、處理器使用率(0~100)與記憶體使用量(GB)
            assert.ok(s.t > 0 && s.cpu >= 0 && s.cpu <= 100 && s.memGb > 0, JSON.stringify(s))
        }
        //規則: 停止後不再取樣
        let n = samples.length
        await new Promise((resolve) => setTimeout(resolve, 1300))
        assert.equal(samples.length, n)
    })

})
