/* global __ENV, open */
import http from 'k6/http'
import { check, sleep, group } from 'k6'
import exec from 'k6/execution'
import encoding from 'k6/encoding'
import { Rate, Trend } from 'k6/metrics'

//壓力測試之 k6 腳本(由 WScanStress 以 k6 執行): 解譯使用方注入之情境(scenario)與各虛擬使用者之 session, 本身不含任何特定系統之請求
//不引用網路上之函式庫, 可於無外網之環境執行
//
//清單檔(MANIFEST, 由 WScanStress 寫入, 結束即刪): { sessions: [{ <變數>: <值> }], scenario }
//  sessions: 每位虛擬使用者之變數(第 i 位取 sessions[(i - 1) % 長度]), 以 {{變數}} 代入請求之網址、標頭與文字本體
//  scenario: {
//    bodies: { <鍵>: <base64> },                 共用之二進位本體
//    bodiesPerVu: { <鍵>: [<base64>, ...] },     各虛擬使用者各自之二進位本體(第 i 位取第 (i - 1) % 長度 個)
//    phases: [                                    每位虛擬使用者每趟依序執行
//      { kind: 'requests', name, timer, steps: [[req, ...], ...] },  steps 依序執行, 同一步之請求並行(http.batch); timer 給予時記錄本階段所需之時間(Trend)與是否全部成功(Rate <timer>_ok)
//      { kind: 'stay', name, sec, ticks: [{ every, reqs: [req, ...] }] },  停留 sec 秒(sec、every 為正整數), 第 t 秒時發出 t 可被 every 整除之 ticks 之請求; 逐秒執行(先 sleep 1 秒再發出), 請求耗時亦計入停留時間
//      { kind: 'sleep', sec },
//    ],
//  }
//  req: { name, method, url, headers, body, check }
//    name: 分組名稱(k6 之 name 標籤, 報告依此分列)
//    body: 無 | { ref: <bodies 之鍵> } | { refPerVu: <bodiesPerVu 之鍵> } | { text: <文字, 可含 {{變數}}> }
//    check: { status: [200], header: { name, equals }, json: [{ path, equals }] }(equals 必須給), 狀態碼不符計入 http_req_failed 之外另計檢核失敗,
//           狀態碼符合而標頭或 JSON 內容不符者計入 app_errors(內容檢核失敗)
//
//環境變數: MANIFEST(必填)、MODE(level|smoke)、VUS、RAMP、DUR、BATCH_PER_HOST、GATE_FAIL、GATE_APP、GATE_P95_MS、NAME_P95_MS、TIMEOUT、OUT(summary.json 之路徑)

let MODE = __ENV.MODE || 'level'
let VUS = Number(__ENV.VUS || 10)
let RAMP = __ENV.RAMP || '30s'
let DUR = __ENV.DUR || '3m'
let BATCH_PER_HOST = Number(__ENV.BATCH_PER_HOST || 6)
let GATE_FAIL = Number(__ENV.GATE_FAIL || 0.05)
let GATE_APP = Number(__ENV.GATE_APP || 0.05)
let GATE_P95_MS = Number(__ENV.GATE_P95_MS || 8000)
let NAME_P95_MS = Number(__ENV.NAME_P95_MS || 2000)
let TIMEOUT = __ENV.TIMEOUT || '60s'

let mf = JSON.parse(open(__ENV.MANIFEST))
let SESSIONS = mf.sessions || [{}]
let SC = mf.scenario
let BODIES = {}
for (let k in (SC.bodies || {})) {
    BODIES[k] = encoding.b64decode(SC.bodies[k], 'std')
}
let BODIES_PER_VU = {}
for (let k in (SC.bodiesPerVu || {})) {
    BODIES_PER_VU[k] = SC.bodiesPerVu[k].map((b) => encoding.b64decode(b, 'std'))
}

//names, timers: 情境中之全部分組名稱與計時名稱(供門檻, 使其列於彙總)
let names = {}
let timers = {}
let addReq = (r) => {
    names[r.name] = true
}
for (let ph of SC.phases) {
    if (ph.kind === 'requests') {
        ph.steps.forEach((st) => st.forEach(addReq))
        if (ph.timer) timers[ph.timer] = true
    }
    if (ph.kind === 'stay') {
        ph.ticks.forEach((tk) => tk.reqs.forEach(addReq))
    }
}

let scenario = {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [{ target: VUS, duration: RAMP }, { target: VUS, duration: DUR }],
    gracefulRampDown: '10s',
    gracefulStop: '30s',
}
if (MODE === 'smoke') {
    scenario = { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '10m' }
}

let thresholds = {
    //安全閘: 連線失敗比例、內容檢核失敗比例或全部請求 p95 任一超過即中止
    //門檻為通過條件(≤ 上限), 超過上限才算未過: 上限為 0(零容忍)時, 零失敗須為通過, 恰等於上限亦不算超過
    http_req_failed: [{ threshold: `rate<=${GATE_FAIL}`, abortOnFail: true, delayAbortEval: '20s' }],
    app_errors: [{ threshold: `rate<=${GATE_APP}`, abortOnFail: true, delayAbortEval: '20s' }],
    http_req_duration: [{ threshold: `p(95)<=${GATE_P95_MS}`, abortOnFail: true, delayAbortEval: '20s' }],
}
for (let n in names) {
    thresholds[`http_req_duration{name:${n}}`] = [`p(95)<=${NAME_P95_MS}`] //分組之門檻, 只供報告標示
}

export let options = {
    scenarios: { users: scenario },
    batchPerHost: BATCH_PER_HOST,
    thresholds,
    summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max', 'count'],
}

let appErrors = new Rate('app_errors')
let kpTimer = {}
let kpTimerOk = {}
for (let t in timers) {
    kpTimer[t] = new Trend(t, true)
    kpTimerOk[t] = new Rate(`${t}_ok`)
}

//vuIndex, 本虛擬使用者之序(自 0 起)
let vuIndex = () => exec.vu.idInTest - 1

//fill, 以本虛擬使用者之 session 代入 {{變數}}
let fill = (s) => {
    if (typeof s !== 'string') return s
    let ss = SESSIONS[vuIndex() % SESSIONS.length]
    return s.replace(/\{\{(\w+)\}\}/g, (m, k) => (ss[k] === undefined ? m : String(ss[k])))
}

//needBody, 檢核需讀回應本體者(JSON 內容)
let needBody = (r) => !!(r.check && r.check.json && r.check.json.length > 0)

//toK6, 請求轉為 http.batch 之格式
let toK6 = (r) => {
    let headers = {}
    for (let k in (r.headers || {})) {
        headers[k] = fill(r.headers[k])
    }
    let body = null
    if (r.body && r.body.ref !== undefined) body = BODIES[r.body.ref]
    if (r.body && r.body.refPerVu !== undefined) {
        let arr = BODIES_PER_VU[r.body.refPerVu]
        body = arr[vuIndex() % arr.length]
    }
    if (r.body && r.body.text !== undefined) body = fill(r.body.text)
    return [r.method || 'GET', fill(r.url), body, { headers, tags: { name: r.name }, responseType: needBody(r) ? 'text' : 'none', timeout: TIMEOUT }]
}

//getPath, 取 JSON 之欄位(以 . 分隔)
let getPath = (o, p) => String(p).split('.').reduce((a, k) => (a === null || a === undefined ? undefined : a[k]), o)

//ckRes, 檢核回應: 狀態碼符合後再檢核標頭與 JSON 內容, 後者不符計入 app_errors
let ckRes = (r, res) => {
    let c = r.check || {}
    let sts = c.status || [200]
    if (!sts.includes(res.status)) {
        appErrors.add(false) //狀態碼不符屬連線或服務之失敗, 不計為內容檢核失敗(分母仍計入, 使比例以全部回應為準)
        return false
    }
    let ok = true
    if (c.header) {
        let v = res.headers[c.header.name]
        if (v === undefined) {
            let kl = Object.keys(res.headers).find((k) => k.toLowerCase() === String(c.header.name).toLowerCase())
            v = kl ? res.headers[kl] : undefined
        }
        ok = ok && v === c.header.equals
    }
    if (c.json && c.json.length > 0) {
        let j = null
        try {
            j = JSON.parse(res.body)
        }
        catch (err) {
            j = null
        }
        ok = ok && j !== null && c.json.every((q) => getPath(j, q.path) === q.equals)
    }
    appErrors.add(!ok)
    return ok
}

//runBatch, 送出一批請求並逐一檢核, 回是否全部成功
let runBatch = (reqs) => {
    if (reqs.length === 0) return true
    let rs = http.batch(reqs.map(toK6))
    let allOk = true
    for (let i = 0; i < rs.length; i++) {
        let r = reqs[i]
        let ok = check(rs[i], { [`${r.name} 成功`]: (res) => ckRes(r, res) })
        allOk = allOk && ok
    }
    return allOk
}

export default function () {
    for (let ph of SC.phases) {
        if (ph.kind === 'requests') {
            group(ph.name || 'requests', function () {
                let t0 = Date.now()
                let ok = true
                for (let st of ph.steps) {
                    ok = runBatch(st) && ok
                }
                if (ph.timer) {
                    kpTimer[ph.timer].add(Date.now() - t0)
                    kpTimerOk[ph.timer].add(ok)
                }
            })
        }
        else if (ph.kind === 'stay') {
            group(ph.name || 'stay', function () {
                for (let t = 1; t <= ph.sec; t++) {
                    sleep(1)
                    let reqs = []
                    for (let tk of ph.ticks) {
                        if (t % tk.every === 0) reqs.push(...tk.reqs)
                    }
                    runBatch(reqs)
                }
            })
        }
        else if (ph.kind === 'sleep') {
            sleep(ph.sec)
        }
    }
}

export function handleSummary(data) {
    //彙總只存 JSON(OUT 為該級 summary.json 之路徑), 文字報告由 WScanStress 產製
    return {
        stdout: `summary => ${__ENV.OUT}\n`,
        [__ENV.OUT || './summary.json']: JSON.stringify(data, null, 1),
    }
}
