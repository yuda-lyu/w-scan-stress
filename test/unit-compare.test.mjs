//
// unit: 兩次結果之對照(src/compare.mjs)
//
// 對應規則(src/compare.mjs 之說明, README 之〈報告與對照〉):
//   改善倍數: 延遲類數值越小越好、吞吐類越大越好; 比值 1.05 以上為改善, 0.95 以下為退步, 其間為持平; 任一無值或為 0 不對照
//   分組與計時取自兩次之彙總本身(聯集); 一方未發出之分組標示無法對照, 兩方皆未發出者不列;
//   門檻: 只列前後狀態不同之分組(✗→✓ 為已改善, 反之為已退步); 安全閘列兩次之觸發狀態
//
import { strict as assert } from 'assert'
import fs from 'fs'
import path from 'path'
import { ratio, buildCompare } from '../src/compare.mjs'


describe('compare: ratio', function () {

    it('延遲類(越小越好)', function () {
        //規則: 比值1.05以上為改善
        assert.equal(ratio(100, 50), '2.00x 改善')
        //規則: 比值0.95以下為退步
        assert.equal(ratio(50, 100), '2.00x 退步')
        //規則: 其間為持平
        assert.equal(ratio(100, 98), '持平')
    })

    it('吞吐類(越大越好)', function () {
        //規則: lower為false時, 後值大者為改善
        assert.equal(ratio(10, 20, false), '2.00x 改善')
        assert.equal(ratio(20, 10, false), '2.00x 退步')
    })

    it('無值或為 0: 不對照', function () {
        //規則: 任一無值或為0回傳-
        assert.equal(ratio(null, 1), '-')
        assert.equal(ratio(1, undefined), '-')
        assert.equal(ratio(0, 1), '-')
    })

})


describe('compare: buildCompare', function () {

    let fd = path.resolve('./test/_tmp/compare')
    let fpA = path.resolve('./test/fixtures/run/vus010/summary.json')
    let fpB = path.join(fd, 'summary_b.json')

    before(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
        //後次: 吞吐加倍, 取清單 p95 由 2.5 秒降為 1 秒(門檻轉為通過), 進入頁面 p95 減半, 查詢改為有發出, 輪詢移除
        let j = JSON.parse(fs.readFileSync(fpA, 'utf8'))
        let m = j.metrics
        m.http_reqs.values.rate = 1.6
        m['http_req_duration{name:list}'].values['p(95)'] = 1000
        m['http_req_duration{name:list}'].thresholds['p(95)<2000'].ok = true
        m.enter_page.values['p(95)'] = 391.5
        m['http_req_duration{name:query}'].values = { 'count': 20, 'avg': 3, 'med': 3, 'p(90)': 4, 'p(95)': 5, 'max': 6 }
        delete m['http_req_duration{name:poll}']
        fs.writeFileSync(fpB, JSON.stringify(j), 'utf8')
    })

    after(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        assert.ok(!fs.existsSync(fd))
    })

    it('整體、計時、各分組與門檻之對照', function () {
        let t = buildCompare(fpA, fpB, { labA: '改善前', labB: '改善後', labels: { enter_page: '進入頁面' } })
        let lines = t.split('\n')
        let row = (head) => {
            let r = lines.find((s) => s.startsWith(head))
            assert.ok(r, `找不到: ${head}\n${t}`)
            return r.trim().split(/\s{2,}/)
        }
        //規則: 標籤
        assert.ok(t.startsWith(`改善前: ${fpA}`))
        //規則: 吞吐類越大越好
        assert.deepEqual(row('請求數 req/s'), ['請求數 req/s', '0.8', '1.6', '2.00x 改善'])
        //規則: 計時取自彙總本身, 以顯示名稱列出
        assert.deepEqual(row('進入頁面 p(95)'), ['進入頁面 p(95)', '783ms', '392ms', '2.00x 改善'])
        //規則: 分組p95之改善倍數
        assert.deepEqual(row('list '), ['list', '2.50s', '1.00s', '2.50x 改善'])
        //規則: 一方未發出者標示無法對照
        assert.deepEqual(row('query '), ['query', '(未發出)', '5ms', '(無法對照)'])
        assert.deepEqual(row('poll '), ['poll', '19ms', '(未發出)', '(無法對照)'])
        //規則: 門檻只列前後狀態不同者
        let th = lines.slice(lines.indexOf('=== 門檻 ===') + 1)
        assert.ok(th.some((s) => /list\s+改善前=✗\s+改善後=✓\s+<= 已改善/.test(s)), th.join('\n'))
        assert.ok(!th.some((s) => /profile/.test(s)))
        //規則: 任一方無門檻結果(poll 於後次未發出)者無法對照, 不判為退步
        assert.ok(!th.some((s) => /poll/.test(s)), th.join('\n'))
        //規則: 安全閘列兩次之觸發狀態
        assert.ok(th.some((s) => /安全閘 http_req_failed rate<0\.05\s+改善前=未觸發\s+改善後=未觸發/.test(s)))
    })

    it('彙總內無 metrics: 拋錯並指出檔案', function () {
        let fpBad = path.join(fd, 'nometrics.json')
        fs.writeFileSync(fpBad, JSON.stringify({ metrics: null }), 'utf8')
        //規則: 彙總內無metrics(非k6之summary.json)者拋錯並指出檔案, 不得以TypeError中止
        assert.throws(() => buildCompare(fpA, fpBad), (err) => err.message.includes('彙總內無 metrics') && err.message.includes(fpBad))
        assert.throws(() => buildCompare(fpBad, fpB), /彙總內無 metrics/)
    })

    it('兩方皆未發出之分組不列', function () {
        let t = buildCompare(fpA, fpA)
        //規則: 兩方皆未發出者不列(query 於前次為 0 次)
        assert.ok(!/^query\s/m.test(t))
        //規則: 預設標籤為前、後
        assert.ok(t.startsWith('前: '))
    })

})
