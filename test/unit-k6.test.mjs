//
// unit: k6 之執行與安全閘(src/k6.mjs), 不需真的 k6(正常執行見 unit-WScanStress.test.mjs)
//
// 對應規則(src/k6.mjs 之說明, README 之〈設計〉〈Options〉之安全閘):
//   locateK6Script: 回傳本套件 k6Scenario.js 之絕對路徑(src 內為同資料夾, 自 dist 執行時為 ../src)
//   k6Version: 回傳 k6 之版本字串; 不存在或不可執行即拋錯並指出路徑
//   runK6: k6 無法啟動(不存在或不可執行)時 reject 並帶明確訊息, 不成為未捕捉之例外, 且 k6.log 已關閉
//   gateTriggered: 該級無彙總(summary.json 不存在、內容損毀、無 metrics 或三項安全閘指標不齊)視為觸發; 連線失敗率、內容檢核失敗率、整體 p95 任一門檻未過即觸發;
//     各請求分組之 p95 門檻只供報告標示, 不觸發
//
import { strict as assert } from 'assert'
import fs from 'fs'
import path from 'path'
import { locateK6Script, k6Version, runK6, gateTriggered } from '../src/k6.mjs'


let fd = path.resolve('./test/_tmp/k6')


describe('k6: locateK6Script、k6Version', function () {

    before(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
    })

    after(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        assert.ok(!fs.existsSync(fd))
    })

    it('locateK6Script: 回傳存在之 k6Scenario.js', function () {
        let fp = locateK6Script()
        //規則: 回傳本套件k6腳本之絕對路徑
        assert.equal(path.basename(fp), 'k6Scenario.js')
        assert.ok(path.isAbsolute(fp))
        assert.ok(fs.existsSync(fp))
    })

    it('k6Version: 不存在或不可執行即拋錯並指出路徑', function () {
        let fpFake = path.join(fd, 'k6.exe')
        fs.writeFileSync(fpFake, 'not an executable', 'utf8')
        //規則: 不可執行即拋錯並指出路徑
        assert.throws(() => k6Version(fpFake), (err) => err.message.includes('無法執行 k6') && err.message.includes(fpFake))
        assert.throws(() => k6Version(path.join(fd, 'none.exe')), /無法執行 k6/)
    })

})


describe('k6: runK6', function () {

    before(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
    })

    after(function () {
        fs.rmSync(fd, { recursive: true, force: true })
    })

    it('k6 不存在或不可執行: reject 並帶明確訊息, k6.log 已關閉', async function () {
        let fpFake = path.join(fd, 'k6.exe')
        fs.writeFileSync(fpFake, 'not an executable', 'utf8')
        for (let exe of [path.join(fd, 'none.exe'), fpFake]) {
            let fdLevel = path.join(fd, exe === fpFake ? 'lv2' : 'lv1')
            fs.mkdirSync(fdLevel, { recursive: true })
            //規則: k6 無法啟動時 reject(帶路徑), 不得成為未捕捉之例外
            await assert.rejects(runK6(exe, 'x.js', {}, fdLevel, true), (err) => err.message.includes('無法啟動 k6') && err.message.includes(exe))
            //規則: 寫入k6.log之串流已關閉(檔案存在且可刪除)
            assert.ok(fs.existsSync(path.join(fdLevel, 'k6.log')))
            fs.rmSync(fdLevel, { recursive: true, force: false })
        }
    })

    it('k6.log 無法寫入(資料夾不存在): reject, 不成為未捕捉之例外', async function () {
        //規則: 寫入k6.log之串流error事件先掛上; k6無法啟動與日誌無法寫入同時發生時, 以其中之一reject(不得有未捕捉之例外)
        let fpFake = path.join(fd, 'k6.exe')
        fs.writeFileSync(fpFake, 'not an executable', 'utf8')
        for (let exe of [path.join(fd, 'none.exe'), fpFake]) {
            await assert.rejects(runK6(exe, 'x.js', {}, path.join(fd, 'nodir'), true), /無法(寫入 k6\.log|啟動 k6)/)
        }
        //讓延後發生之串流錯誤有機會浮現
        await new Promise((resolve) => setTimeout(resolve, 100))
    })

})


describe('k6: gateTriggered', function () {

    before(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
    })

    after(function () {
        fs.rmSync(fd, { recursive: true, force: true })
    })

    //put, 寫出彙總並回傳路徑; ok 為各安全閘門檻是否通過
    let put = (name, obj) => {
        let fp = path.join(fd, `${name}.json`)
        fs.writeFileSync(fp, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8')
        return fp
    }
    let th = (ok) => ({ thresholds: { x: { ok } } })
    let summary = (f, a, d, extra = {}) => ({ metrics: { http_req_failed: th(f), app_errors: th(a), http_req_duration: th(d), ...extra } })

    it('無彙總(不存在、內容損毀、無 metrics 或安全閘指標不齊): 視為觸發', function () {
        //規則: 該級無結果視為觸發
        assert.equal(gateTriggered(path.join(fd, 'none.json')), true)
        assert.equal(gateTriggered(put('broken', '{"metrics": {')), true)
        assert.equal(gateTriggered(put('nometrics', {})), true)
        //規則: 空或陣列之metrics、缺任一項安全閘指標、門檻結果為空者, 皆非完整結果而視為觸發(不得因「沒有未過者」而判為通過)
        assert.equal(gateTriggered(put('emptymetrics', { metrics: {} })), true)
        assert.equal(gateTriggered(put('arraymetrics', { metrics: [] })), true)
        assert.equal(gateTriggered(put('partial', { metrics: { http_req_failed: th(true) } })), true)
        assert.equal(gateTriggered(put('nothresholds', { metrics: { http_req_failed: th(true), app_errors: { thresholds: {} }, http_req_duration: th(true) } })), true)
    })

    it('三項安全閘皆通過: 不觸發; 任一未過: 觸發', function () {
        //規則: 連線失敗率、內容檢核失敗率、整體p95皆通過者不觸發
        assert.equal(gateTriggered(put('ok', summary(true, true, true))), false)
        //規則: 任一門檻未過即觸發
        assert.equal(gateTriggered(put('f', summary(false, true, true))), true)
        assert.equal(gateTriggered(put('a', summary(true, false, true))), true)
        assert.equal(gateTriggered(put('d', summary(true, true, false))), true)
    })

    it('各請求分組之 p95 門檻未過: 只供報告標示, 不觸發', function () {
        //規則: 分組之門檻只供報告標示, 不中止
        let s = summary(true, true, true, { 'http_req_duration{name:list}': th(false) })
        assert.equal(gateTriggered(put('name', s)), false)
    })

})
