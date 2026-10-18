//
// unit: 預設參數與 opt 之檢核整理(src/config.mjs 之 normOpt), 不需 k6、不需網路
//
// 對應規則(src/config.mjs 之說明, README 之〈Options〉):
//   預設: mode 為 level, levels 為 [10,25,50,75,100,150,200], ramp 30s, dur 3m, gap 30, batchPerHost 6, 安全閘同 GATE, label 由級距組成
//   mode 為 smoke 時 levels 固定為 [1]、label 預設 smoke(不檢核 levels); mode 為其他值視為 level
//   levels 為正整數(數字字串亦可)之非空陣列; ramp、dur、gate.timeout 為 k6 之時間格式; gap 為非負數; batchPerHost 為正整數;
//   gate 之門檻為非負數, 覆寫值併入預設; label 不含路徑分隔與檔名禁用字元; procPorts 之值為 1~65535 之整數
//
import { strict as assert } from 'assert'
import { normOpt, DEFAULTS, GATE, RESERVED_METRICS, GATE_METRICS } from '../src/config.mjs'


describe('config: normOpt', function () {

    it('預設值', function () {
        let r = normOpt({})
        //規則: 預設值同DEFAULTS與GATE
        assert.deepEqual(r, {
            mode: 'level',
            levels: [10, 25, 50, 75, 100, 150, 200],
            ramp: '30s',
            dur: '3m',
            gap: 30,
            batchPerHost: 6,
            gate: GATE,
            label: '10-25-50-75-100-150-200',
            procPorts: {},
        })
        assert.deepEqual(r.levels, DEFAULTS.levels)
        //規則: 回傳之gate為複本, 改動不影響預設
        assert.notEqual(r.gate, GATE)
    })

    it('smoke: levels 固定為 [1] 且不檢核; 其他 mode 值視為 level', function () {
        //規則: smoke時levels固定為[1], label預設smoke
        let r = normOpt({ mode: 'smoke', levels: [0, 'x'] })
        assert.deepEqual([r.mode, r.levels, r.label], ['smoke', [1], 'smoke'])
        //規則: mode為其他值視為level
        assert.equal(normOpt({ mode: 'other' }).mode, 'level')
    })

    it('levels: 數字字串轉為數字, 標籤由級距組成', function () {
        let r = normOpt({ levels: ['10', 25] })
        //規則: levels為正整數(數字字串亦可)
        assert.deepEqual([r.levels, r.label], [[10, 25], '10-25'])
        //規則: 非正整數、空陣列、非陣列、稀疏陣列之空位者拋錯並指出欄位
        for (let v of [[], [0], [1.5], ['x'], [''], [-1], 10, 'abc', [, 1], new Array(2)]) { // eslint-disable-line no-sparse-arrays
            assert.throws(() => normOpt({ levels: v }), /opt\.levels 須為正整數之非空陣列/, JSON.stringify(v))
        }
    })

    it('levels 不得重複(各級以人數命名輸出資料夾, 重複者會互相覆寫)', function () {
        //規則: 重複之級距拋錯(含數字與數字字串同值)
        for (let v of [[1, 1], [10, 25, 10], ['10', 10]]) {
            assert.throws(() => normOpt({ levels: v }), /opt\.levels 不得重複/, JSON.stringify(v))
        }
        //規則: 不要求遞增, 依給定順序逐級
        assert.deepEqual(normOpt({ levels: [50, 10] }).levels, [50, 10])
    })

    it('ramp、dur、gate.timeout: k6 之時間格式', function () {
        //規則: 數字加單位ns、us、µs、ms、s、m、h、d, 可連寫, 可為小數(以k6 v2.3.0之inspect實測: 接受1d、.5s、100us, 不接受1w、3x)
        for (let v of ['30s', '3m', '1m30s', '500ms', '1.5h', '.5s', '100us', '2µs', '1d', '2h45m', '10ns']) {
            let r = normOpt({ ramp: v, dur: v, gate: { timeout: v } })
            assert.deepEqual([r.ramp, r.dur, r.gate.timeout], [v, v, v])
        }
        //規則: 其他格式(含空字串)拋錯並指出欄位; undefined、null 才取預設
        assert.equal(normOpt({ ramp: undefined, dur: null }).ramp, DEFAULTS.ramp)
        assert.equal(normOpt({ ramp: undefined, dur: null }).dur, DEFAULTS.dur)
        //(裸數字 k6 視為毫秒, 易誤把秒當毫秒, 本套件要求帶單位; 整數部分超過 9 位者 k6 於初始化失敗)
        for (let v of ['', '30', '30 s', 's', '3x', '1w', 'abc', 5, '9999999999h']) {
            assert.throws(() => normOpt({ ramp: v }), /opt\.ramp/, String(v))
            assert.throws(() => normOpt({ dur: v }), /opt\.dur/, String(v))
            assert.throws(() => normOpt({ gate: { timeout: v } }), /opt\.gate\.timeout/, String(v))
        }
    })

    it('gap、batchPerHost', function () {
        //規則: gap為非負數(0與數字字串可)
        assert.equal(normOpt({ gap: 0 }).gap, 0)
        assert.equal(normOpt({ gap: '5' }).gap, 5)
        //規則: 空字串不當成0
        for (let v of [-1, 'x', Infinity, '', ' ']) {
            assert.throws(() => normOpt({ gap: v }), /opt\.gap/, JSON.stringify(v))
        }
        //規則: batchPerHost為正整數
        assert.equal(normOpt({ batchPerHost: '3' }).batchPerHost, 3)
        for (let v of [0, -1, 1.5, 'x', '']) {
            assert.throws(() => normOpt({ batchPerHost: v }), /opt\.batchPerHost/, JSON.stringify(v))
        }
        //規則: 未給(undefined、null)時取預設
        assert.equal(normOpt({}).batchPerHost, DEFAULTS.batchPerHost)
        assert.equal(normOpt({ batchPerHost: null }).batchPerHost, DEFAULTS.batchPerHost)
    })

    it('gate: 覆寫值併入預設, 門檻為非負數', function () {
        //規則: 覆寫值併入預設
        assert.deepEqual(normOpt({ gate: { p95Ms: 100 } }).gate, { ...GATE, p95Ms: 100 })
        assert.deepEqual(normOpt({ gate: { failRate: 0 } }).gate, { ...GATE, failRate: 0 })
        //規則: 門檻為非負數
        for (let k of ['failRate', 'appErrRate', 'p95Ms', 'nameP95Ms']) {
            for (let v of [-1, '1', NaN, Infinity]) {
                assert.throws(() => normOpt({ gate: { [k]: v } }), new RegExp(`opt\\.gate\\.${k}`), `${k}=${v}`)
            }
        }
        //規則: gate須為物件
        assert.throws(() => normOpt({ gate: [] }), /opt\.gate 須為物件/)
        assert.throws(() => normOpt({ gate: 'x' }), /opt\.gate 須為物件/)
    })

    it('label: 不含路徑分隔與檔名禁用字元', function () {
        //規則: 中文、空白、點、底線皆可
        for (let v of ['壓測_v2', 'a b', 'a.b', 'a-1']) {
            assert.equal(normOpt({ label: v }).label, v)
        }
        //規則: 路徑分隔、檔名禁用字元與控制字元拋錯
        for (let v of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0001b']) {
            assert.throws(() => normOpt({ label: v }), /opt\.label/, JSON.stringify(v))
        }
        //規則: 不得超過100字元(結果資料夾之路徑長度有上限, 過長者在取得session後才建立資料夾失敗)
        assert.equal(normOpt({ label: 'x'.repeat(100) }).label.length, 100)
        assert.throws(() => normOpt({ label: 'x'.repeat(101) }), /opt\.label 不得超過 100 字元/)
    })

    it('fpPending: 須為字串', function () {
        //規則: fpPending 給了則須為字串
        for (let v of [5, {}, [], true]) {
            assert.throws(() => normOpt({ fpPending: v }), /opt\.fpPending 須為字串/, JSON.stringify(v))
        }
        normOpt({ fpPending: './x/p.json' })
        normOpt({ fpPending: undefined })
        normOpt({ fpPending: null })
    })

    it('procPorts: 值為 1~65535 之整數', function () {
        assert.deepEqual(normOpt({ procPorts: { api: 8000, auth: 65535 } }).procPorts, { api: 8000, auth: 65535 })
        //規則: 值須為1~65535之整數, 錯誤訊息指出鍵名
        for (let v of [0, 65536, 1.5, '8000', null]) {
            assert.throws(() => normOpt({ procPorts: { api: v } }), /opt\.procPorts\.api/, String(v))
        }
        assert.throws(() => normOpt({ procPorts: [] }), /opt\.procPorts 須為物件/)
    })

})


describe('config: 常數', function () {

    it('RESERVED_METRICS 含 k6 內建指標與 app_errors; GATE_METRICS 為三項安全閘', function () {
        //規則: timer不得與k6內建指標或app_errors同名
        for (let k of ['http_reqs', 'http_req_duration', 'iterations', 'vus', 'checks', 'app_errors']) {
            assert.ok(RESERVED_METRICS.includes(k), k)
        }
        //規則: 安全閘依據連線失敗比例、內容檢核失敗比例、全部請求之回應時間
        assert.deepEqual(GATE_METRICS, ['http_req_failed', 'app_errors', 'http_req_duration'])
    })

})
