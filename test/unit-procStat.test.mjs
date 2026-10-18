//
// unit: 資源記錄(src/procStat.mjs), 以本測試程序及其監聽之埠(8093)為對象
//
// 對應規則(src/procStat.mjs 之說明, README 之〈設計〉procPorts):
//   pidOfPort: 以 netstat 取監聽指定埠之行程 PID, 無則為 ''; 埠號須為整數(不將其他字串組入正規表示式)
//   procStat: 以 tasklist 取行程之記憶體(MB)與累計處理器時間(秒), 取不到為 null
//   snapProcs: 依行程鍵名對埠號取各行程之資源
//   startSampler: 每秒取樣整機處理器使用率與記憶體, 停止後不再取樣
//
import { strict as assert } from 'assert'
import net from 'net'
import { pidOfPort, procStat, snapProcs, startSampler } from '../src/procStat.mjs'


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

    it('pidOfPort: 取監聽指定埠之行程; 無監聽或埠號不合法為空字串', function () {
        //規則: 取監聽指定埠之行程PID
        assert.equal(pidOfPort(port), String(process.pid))
        //規則: 找不到則回傳''
        assert.equal(pidOfPort(portFree), '')
        //規則: 埠號須為整數, 其他字串不組入正規表示式(此處的 . 不得匹配任意字元)
        assert.equal(pidOfPort('80.3'), '')
        assert.equal(pidOfPort('8093|1'), '')
        assert.equal(pidOfPort(undefined), '')
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

    it('snapProcs: 依鍵名對埠號取各行程之資源, 取不到者為 null', function () {
        let r = snapProcs({ self: port, none: portFree })
        //規則: 回傳行程鍵名對{pid,memMb,cpuSec}之物件, 取不到者為null
        assert.equal(r.self.pid, String(process.pid))
        assert.equal(r.none, null)
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
