//
// unit: 情境之檢查、摘要與 session 之遮蔽(src/scenario.mjs)
//
// 對應規則(src/scenario.mjs 之說明, src/k6Scenario.js 之情境格式, README 之〈情境〉〈session 與遮蔽〉):
//   情境須為物件且有非空之 phases; kind 只能為 requests、stay、sleep; requests 須有非空之 steps(每步為請求之陣列);
//   stay 須有正整數之 sec 與 ticks(every 為正整數、reqs 為請求之陣列); sleep 須有非負數之 sec; 請求之 name 為英數字、底線、點、冒號或連字號(不得為 __proto__), 須有 url;
//   body.ref 須在 bodies、body.refPerVu 須在 bodiesPerVu(自有鍵); bodies、bodiesPerVu 之內容為合法之標準 base64 字串, bodiesPerVu 之各項為非空陣列;
//   timer 為英數字與底線且不以數字開頭, 不得與 k6 內建指標或 app_errors 同名、不得以 _ok 結尾;
//   method、headers、body、check(含 equals 必須給且可序列化)之型別須能被 k6 腳本使用(其格式在施壓前即檢查, 不待 k6 執行期才失敗); 稀疏陣列之空位視為未給
//   摘要: 各階段之種類、名稱、計時與請求數, 全部分組名稱(依出現順序不重複)與計時名稱
//   遮蔽: session 中字串且長度 8 以上之值改為 <鍵>, 值相同者只取一次, 長者先遮蔽; maskDeep 先遮蔽再序列化(含跳脫字元之值亦遮蔽); maskFile 原地遮蔽檔案
//   釋放: releaseAll 回傳未能釋放者; 拋錯或回傳非陣列視為全部未能釋放, 訊息中 session 之值已遮蔽
//
import { strict as assert } from 'assert'
import fs from 'fs'
import path from 'path'
import { validateScenario, summarizeScenario, collectSecrets, maskSecrets, maskDeep, maskFile, releaseAll } from '../src/scenario.mjs'


//req, 最小之請求
let req = (o = {}) => ({ name: 'a', url: 'http://127.0.0.1:8000/a', ...o })


describe('scenario: validateScenario', function () {

    it('合格之情境: 回傳原物件', function () {
        let sc = {
            bodies: { b: 'AQID' },
            bodiesPerVu: { p: ['AQ==', 'Ag=='] },
            phases: [
                { kind: 'requests', name: 'enter', timer: 'enter_page', steps: [[req({ body: { ref: 'b' } })], [req({ name: 'x.y:z-1', body: { refPerVu: 'p' } })]] },
                { kind: 'stay', sec: 4, ticks: [{ every: 2, reqs: [req({ body: { text: '{{token}}' } })] }] },
                { kind: 'sleep', sec: 0 },
            ],
        }
        //規則: 合格者回傳原情境物件
        assert.equal(validateScenario(sc), sc)
    })

    it('非物件或無 phases: 拋錯', function () {
        //規則: 情境須為物件
        assert.throws(() => validateScenario(null), /情境須為物件/)
        //規則: 須有 phases(非空陣列)
        assert.throws(() => validateScenario({}), /須有 phases/)
        assert.throws(() => validateScenario({ phases: [] }), /須有 phases/)
    })

    it('kind 不明: 拋錯並指出位置', function () {
        //規則: kind 只能為 requests、stay、sleep
        assert.throws(() => validateScenario({ phases: [{ kind: 'x' }] }), /phases\[0\]: kind 須為 requests、stay 或 sleep/)
    })

    it('requests 之 steps 為空或非請求陣列: 拋錯', function () {
        //規則: requests 須有非空之 steps
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', steps: [] }] }), /requests 須有 steps/)
        //規則: 每步為請求之陣列
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', steps: [req()] }] }), /steps\[0\] 須為請求之陣列/)
    })

    it('請求之 name 含不允許之字元或缺 url: 拋錯', function () {
        //規則: name 為英數字、底線、點、冒號或連字號
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', steps: [[req({ name: 'a b' })]] }] }), /name 須為英數字/)
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', steps: [[req({ name: '' })]] }] }), /name 須為英數字/)
        //規則: 須有 url
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', steps: [[req({ url: '' })]] }] }), /須有 url/)
    })

    it('body 之 ref、refPerVu 不存在: 拋錯', function () {
        //規則: body.ref 須在 bodies
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', steps: [[req({ body: { ref: 'none' } })]] }] }), /body\.ref 不在 bodies:none/)
        //規則: body.refPerVu 須在 bodiesPerVu
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', steps: [[req({ body: { refPerVu: 'none' } })]] }] }), /body\.refPerVu 不在 bodiesPerVu:none/)
    })

    it('bodiesPerVu 之項為空陣列: 拋錯', function () {
        //規則: bodiesPerVu 之各項為非空陣列
        assert.throws(() => validateScenario({ bodiesPerVu: { p: [] }, phases: [{ kind: 'sleep', sec: 1 }] }), /bodiesPerVu\.p 須為非空陣列/)
    })

    it('timer 不合格: 拋錯', function () {
        //規則: timer 為英數字與底線且不以數字開頭
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', timer: '1a', steps: [[req()]] }] }), /timer 須為英數字與底線/)
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', timer: 'a-b', steps: [[req()]] }] }), /timer 須為英數字與底線/)
    })

    it('stay 缺 sec、ticks 或 every 非正數: 拋錯', function () {
        //規則: stay 須有正數之 sec
        assert.throws(() => validateScenario({ phases: [{ kind: 'stay', sec: 0, ticks: [] }] }), /stay 須有 sec/)
        //規則: stay 須有 ticks
        assert.throws(() => validateScenario({ phases: [{ kind: 'stay', sec: 2 }] }), /stay 須有 ticks/)
        //規則: every 為正數
        assert.throws(() => validateScenario({ phases: [{ kind: 'stay', sec: 2, ticks: [{ every: 0, reqs: [] }] }] }), /every 須為正整數/)
        //規則: sec、every 須為正整數(k6 腳本逐秒執行, 小數之 sec 會被截斷、小數之 every 無法整除)
        assert.throws(() => validateScenario({ phases: [{ kind: 'stay', sec: 2.5, ticks: [] }] }), /stay 須有 sec/)
        assert.throws(() => validateScenario({ phases: [{ kind: 'stay', sec: '4', ticks: [] }] }), /stay 須有 sec/)
        assert.throws(() => validateScenario({ phases: [{ kind: 'stay', sec: 2, ticks: [{ every: 0.5, reqs: [] }] }] }), /every 須為正整數/)
        //規則: ticks 之 reqs 須為請求之陣列(不得到 k6 執行時才以執行期例外出現)
        assert.throws(() => validateScenario({ phases: [{ kind: 'stay', sec: 2, ticks: [{ every: 1 }] }] }), /ticks\[0\]: reqs 須為請求之陣列/)
        assert.throws(() => validateScenario({ phases: [{ kind: 'stay', sec: 2, ticks: [null] }] }), /ticks\[0\] 須為物件/)
    })

    it('sleep 之 sec 為負數、階段非物件: 拋錯', function () {
        //規則: sleep 須有非負數之 sec
        assert.throws(() => validateScenario({ phases: [{ kind: 'sleep', sec: -1 }] }), /sleep 須有 sec/)
        assert.throws(() => validateScenario({ phases: [{ kind: 'sleep' }] }), /sleep 須有 sec/)
        //規則: 階段須為物件
        assert.throws(() => validateScenario({ phases: [null] }), /phases\[0\] 須為物件/)
    })

    it('bodies、bodiesPerVu 之內容須為 base64 字串', function () {
        //規則: bodies 之各項為 base64 字串(k6 以 b64decode 解碼, 非字串者於 k6 初始化時才失敗)
        assert.throws(() => validateScenario({ bodies: { b: 123 }, phases: [{ kind: 'sleep', sec: 1 }] }), /bodies\.b 須為 base64 字串/)
        //規則: bodiesPerVu 之各項為 base64 字串
        assert.throws(() => validateScenario({ bodiesPerVu: { p: ['AQ==', 5] }, phases: [{ kind: 'sleep', sec: 1 }] }), /bodiesPerVu\.p\[1\] 須為 base64 字串/)
        //規則: 須為標準編碼且含補齊(k6 之 b64decode 'std'), 非法字元、缺補齊、URL-safe 字元者拒收; 空字串可
        for (let v of ['AQI', 'A', 'AQ=', 'AQ==AQ==', 'A-_B', '中文', 'AQ ==']) {
            assert.throws(() => validateScenario({ bodies: { b: v }, phases: [{ kind: 'sleep', sec: 1 }] }), /bodies\.b 須為 base64 字串/, v)
            assert.throws(() => validateScenario({ bodiesPerVu: { p: [v] }, phases: [{ kind: 'sleep', sec: 1 }] }), /bodiesPerVu\.p\[0\] 須為 base64 字串/, v)
        }
        for (let v of ['', 'AQID', 'AQ==', 'AQI=', Buffer.from('示範之二進位本體').toString('base64')]) {
            validateScenario({ bodies: { b: v }, bodiesPerVu: { p: [v] }, phases: [{ kind: 'sleep', sec: 1 }] })
        }
    })

    it('階段之 name 須為字串', function () {
        //規則: name 作為 k6 之 group 名稱, 須為字串
        assert.throws(() => validateScenario({ phases: [{ kind: 'sleep', sec: 1, name: 5 }] }), /phases\[0\]: name 須為字串/)
        validateScenario({ phases: [{ kind: 'sleep', sec: 1, name: '等待' }] })
    })

    it('請求之 method、headers、url、body 型別不合: 拋錯', function () {
        let one = (o) => validateScenario({ phases: [{ kind: 'requests', steps: [[req(o)]] }] })
        //規則: method 為英文字母開頭、僅含英數字、底線與連字號之字串(HTTP 方法為 token, 可含連字號, 如 M-SEARCH)
        assert.throws(() => one({ method: 1 }), /method 須為英文字母開頭/)
        assert.throws(() => one({ method: 'GE T' }), /method 須為英文字母開頭/)
        assert.throws(() => one({ method: '1GET' }), /method 須為英文字母開頭/)
        one({ method: 'M-SEARCH' })
        one({ method: 'patch' })
        //規則: headers 為物件
        assert.throws(() => one({ headers: [] }), /headers 須為物件/)
        assert.throws(() => one({ headers: 'x' }), /headers 須為物件/)
        //規則: url 為字串
        assert.throws(() => one({ url: 123 }), /url 須為字串/)
        //規則: body 為物件, body.text 為字串
        assert.throws(() => one({ body: 'x' }), /body 須為物件/)
        assert.throws(() => one({ body: { text: 5 } }), /body\.text 須為字串/)
        assert.throws(() => one({ body: [] }), /body 須為物件/)
        //規則: 合格者不拋錯
        one({ method: 'POST', headers: { a: '{{b}}' }, body: { text: 'x' } })
    })

    it('請求之 check 型別不合: 拋錯(k6 以 includes、every 等使用之)', function () {
        let one = (check) => validateScenario({ phases: [{ kind: 'requests', steps: [[req({ check })]] }] })
        //規則: check 為物件
        assert.throws(() => one('x'), /check 須為物件/)
        //規則: check.status 為非空之整數陣列
        assert.throws(() => one({ status: 200 }), /check\.status 須為非空之整數陣列/)
        assert.throws(() => one({ status: [] }), /check\.status 須為非空之整數陣列/)
        assert.throws(() => one({ status: ['200'] }), /check\.status 須為非空之整數陣列/)
        //規則: check.header 為物件且有 name
        assert.throws(() => one({ header: 'x' }), /check\.header 須為有 name 之物件/)
        assert.throws(() => one({ header: { equals: 'x' } }), /check\.header 須為有 name 之物件/)
        //規則: check.json 為陣列, 各項有 path
        assert.throws(() => one({ json: { path: 'a', equals: 1 } }), /check\.json 須為陣列/)
        assert.throws(() => one({ json: [{ equals: 1 }] }), /check\.json\[0\] 須有 path/)
        //規則: equals 必須給且可序列化(缺少時 undefined === undefined, 缺少的標頭或欄位反而通過檢核)
        assert.throws(() => one({ header: { name: 'X-A' } }), /check\.header\.equals 須為字串/)
        assert.throws(() => one({ header: { name: 'X-A', equals: 1 } }), /check\.header\.equals 須為字串/)
        assert.throws(() => one({ json: [{ path: 'a' }] }), /check\.json\[0\]\.equals 須為字串、有限數字、布林或 null/)
        assert.throws(() => one({ json: [{ path: 'a', equals: undefined }] }), /check\.json\[0\]\.equals/)
        assert.throws(() => one({ json: [{ path: 'a', equals: NaN }] }), /check\.json\[0\]\.equals/)
        assert.throws(() => one({ json: [{ path: 'a', equals: {} }] }), /check\.json\[0\]\.equals/)
        //規則: 合格者不拋錯(equals 可為字串、有限數字、布林、null)
        one({ status: [200, 204], header: { name: 'Content-Type', equals: 'x' }, json: [{ path: 'a.b', equals: 1 }] })
        one({ json: [{ path: 'a', equals: 'x' }, { path: 'b', equals: true }, { path: 'c', equals: null }, { path: 'd', equals: 0 }] })
        one(undefined)
    })

    it('稀疏陣列: 空位視為未給而拒收(序列化後空位會變成 null)', function () {
        let sleep = { kind: 'sleep', sec: 1 }
        //規則: 各陣列之每個索引皆須檢核, 不得因 forEach、every 跳過空位而放行
        assert.throws(() => validateScenario({ phases: new Array(1) }), /phases\[0\] 須為物件/)
        assert.throws(() => validateScenario({ phases: [sleep, , sleep] }), /phases\[1\] 須為物件/) // eslint-disable-line no-sparse-arrays
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', steps: new Array(1) }] }), /steps\[0\] 須為請求之陣列/)
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', steps: [new Array(1)] }] }), /steps\[0\]\[0\]: 請求須為物件/)
        assert.throws(() => validateScenario({ phases: [{ kind: 'stay', sec: 2, ticks: new Array(1) }] }), /ticks\[0\] 須為物件/)
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', steps: [[req({ check: { status: [200, , 201] } })]] }] }), /check\.status 須為非空之整數陣列/) // eslint-disable-line no-sparse-arrays
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', steps: [[req({ check: { json: new Array(1) } })]] }] }), /check\.json\[0\] 須有 path/)
        assert.throws(() => validateScenario({ bodiesPerVu: { p: new Array(2) }, phases: [sleep] }), /bodiesPerVu\.p\[0\] 須為 base64 字串/)
    })

    it('原型屬性名稱: 不得作為分組名稱、計時名稱或本體引用', function () {
        //規則: __proto__ 無法作為普通物件的鍵(k6 腳本以物件記錄分組與計時), 拒收
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', steps: [[req({ name: '__proto__' })]] }] }), /請求之 name 須為/)
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', timer: '__proto__', steps: [[req()]] }] }), /timer 不得與 k6 內建指標或 app_errors 同名/)
        //規則: body.ref、body.refPerVu 須為使用方自己給的鍵, 繼承自 Object.prototype 者(如 toString)不算存在
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', steps: [[req({ body: { ref: 'toString' } })]] }] }), /body\.ref 不在 bodies:toString/)
        assert.throws(() => validateScenario({ phases: [{ kind: 'requests', steps: [[req({ body: { refPerVu: 'constructor' } })]] }] }), /body\.refPerVu 不在 bodiesPerVu:constructor/)
        //規則: 合格之名稱(含 toString 這類一般字串)不拋錯
        validateScenario({ phases: [{ kind: 'requests', timer: 'toString_t', steps: [[req({ name: 'toString' })]] }] })
    })

    it('timer 不得與內建指標同名或以 _ok 結尾', function () {
        let one = (timer) => validateScenario({ phases: [{ kind: 'requests', timer, steps: [[req()]] }] })
        //規則: timer 不得與 k6 內建指標或 app_errors 同名(k6 建立指標時重名即失敗)
        assert.throws(() => one('http_reqs'), /timer 不得與 k6 內建指標或 app_errors 同名.*:http_reqs/)
        assert.throws(() => one('app_errors'), /timer 不得與 k6 內建指標或 app_errors 同名/)
        //規則: timer 不得以 _ok 結尾(<timer>_ok 為其全部成功之比例指標)
        assert.throws(() => one('enter_ok'), /timer 不得以 _ok 結尾:enter_ok/)
        //規則: 合格者不拋錯
        one('enter_page')
    })

})


describe('scenario: summarizeScenario', function () {

    it('各階段之請求數、分組名稱(依出現順序不重複)與計時', function () {
        let sc = {
            phases: [
                { kind: 'requests', name: 'enter', timer: 'enter_page', steps: [[req({ name: 'p' })], [req({ name: 'l' }), req({ name: 'q' })]] },
                { kind: 'stay', name: 'stay', sec: 4, ticks: [{ every: 2, reqs: [req({ name: 'poll' })] }, { every: 3, reqs: [req({ name: 'l' })] }] },
                { kind: 'sleep', sec: 1 },
            ],
        }
        let r = summarizeScenario(sc)
        //規則: 各階段之種類、名稱、計時與請求數
        assert.deepEqual(r.phases, [
            { kind: 'requests', name: 'enter', timer: 'enter_page', nReqs: 3 },
            { kind: 'stay', name: 'stay', timer: '', nReqs: 2 },
            { kind: 'sleep', name: '', timer: '', nReqs: 0 },
        ])
        //規則: 全部分組名稱依出現順序不重複
        assert.deepEqual(r.names, ['p', 'l', 'q', 'poll'])
        //規則: 計時名稱
        assert.deepEqual(r.timers, ['enter_page'])
    })

})


describe('scenario: collectSecrets、maskSecrets', function () {

    it('只取字串且長度 8 以上之值, 值相同者只取一次, 長者在前', function () {
        let r = collectSecrets([
            { token: 'abcdefgh12345678', name: 'u1', n: 123456789 },
            { token: 'abcdefgh12345678', key: 'abcdefgh' },
        ])
        //規則: 字串且長度 8 以上; 值相同者只取一次; 依長度由長至短
        assert.deepEqual(r, [{ key: 'token', value: 'abcdefgh12345678' }, { key: 'key', value: 'abcdefgh' }])
        //規則: 無 session 時為空
        assert.deepEqual(collectSecrets(undefined), [])
    })

    it('遮蔽全部出現處為 <鍵>, 長者先遮蔽(不留短值之殘片)', function () {
        let secrets = collectSecrets([{ token: 'abcdefgh12345678', key: 'abcdefgh' }])
        let t = maskSecrets('a=abcdefgh12345678&b=abcdefgh12345678&c=abcdefgh', secrets)
        //規則: session 之值改為 <鍵>
        assert.equal(t, 'a=<token>&b=<token>&c=<key>')
        //規則: 無須遮蔽者不變
        assert.equal(maskSecrets('none', secrets), 'none')
    })

})


describe('scenario: maskDeep、maskFile、releaseAll', function () {

    let fd = path.resolve('./test/_tmp/scenario')

    before(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
    })

    after(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        assert.ok(!fs.existsSync(fd))
    })

    it('maskDeep: 先遮蔽再序列化, 含引號與反斜線之值亦遮蔽, 佔位符含引號時 JSON 仍合法', function () {
        let secrets = collectSecrets([{ 'token': 'ab"cd\\ef-1234', 'bad"key': 'plainvalue123' }])
        let src = { 'scenario': { name: 'x ab"cd\\ef-1234 y', list: ['plainvalue123', 5, null, true] }, 'n': 1, 'k ab"cd\\ef-1234': 'v' }
        let j = JSON.parse(JSON.stringify(maskDeep(src, secrets), null, 2))
        //規則: 值與鍵名中之session值皆改為<鍵>(序列化前遮蔽, 已跳脫之值也不遺漏)
        assert.equal(j.scenario.name, 'x <token> y')
        assert.deepEqual(j.scenario.list, ['<bad"key>', 5, null, true])
        assert.deepEqual(Object.keys(j), ['scenario', 'n', 'k <token>'])
        //規則: 不改動來源物件
        assert.equal(src.scenario.name, 'x ab"cd\\ef-1234 y')
        //規則: 對已序列化之文字直接替換則會漏掉已跳脫之值(此為改為先遮蔽再序列化之原因)
        let t = maskSecrets(JSON.stringify(src), secrets)
        assert.ok(t.includes(JSON.stringify('ab"cd\\ef-1234').slice(1, -1)))
    })

    it('maskFile: 原地遮蔽, 無須遮蔽或檔案不存在者不改寫', function () {
        let fp = path.join(fd, 'k6.log')
        let secrets = collectSecrets([{ token: 'abcdefgh12345678' }])
        fs.writeFileSync(fp, 'Request Failed url=http://127.0.0.1:1/x?token=abcdefgh12345678\n', 'utf8')
        //規則: 含session之值者原地遮蔽並回傳true
        assert.equal(maskFile(fp, secrets), true)
        assert.equal(fs.readFileSync(fp, 'utf8'), 'Request Failed url=http://127.0.0.1:1/x?token=<token>\n')
        //規則: 已無須遮蔽者回傳false且不改寫
        assert.equal(maskFile(fp, secrets), false)
        //規則: 檔案不存在則略過
        assert.equal(maskFile(path.join(fd, 'none.log'), secrets), false)
    })

    it('releaseAll: 回傳未能釋放者; 拋錯或非陣列(含未回傳值)視為全部未能釋放, 訊息已遮蔽', async function () {
        let sessions = [{ token: 'abcdefgh12345678' }, { token: 'zyxwvuts87654321' }]
        let secrets = collectSecrets(sessions)
        let logs = []
        let log = (m) => logs.push(m)
        //規則: 回傳陣列者原樣採用(空陣列為全部釋放)
        assert.deepEqual(await releaseAll(async () => [], sessions, secrets, log), [])
        assert.deepEqual(await releaseAll(async (ss) => [ss[1]], sessions, secrets, log), [sessions[1]])
        assert.equal(logs.length, 0)
        //規則: 回傳非陣列(含 undefined、null、false、0、空字串、字串、true、物件)視為全部未能釋放, 不得當成全部釋放
        for (let v of [undefined, null, false, 0, '', 'ok', true, {}]) {
            assert.deepEqual(await releaseAll(async () => v, sessions, secrets, log), sessions, JSON.stringify(v))
        }
        assert.equal(logs.length, 8)
        //規則: 拋錯(同步或非同步)視為全部未能釋放, 不拋出; 訊息中 session 之值已遮蔽
        logs.length = 0
        assert.deepEqual(await releaseAll(() => {
            throw new Error('logout failed for abcdefgh12345678')
        }, sessions, secrets, log), sessions)
        assert.deepEqual(await releaseAll(async () => {
            throw new Error('boom zyxwvuts87654321\nstack')
        }, sessions, secrets, log), sessions)
        assert.equal(logs.length, 2)
        assert.ok(logs[0].includes('logout failed for <token>'), logs[0])
        assert.ok(logs[1].includes('boom <token>') && !logs[1].includes('stack'), logs[1])
    })

})
