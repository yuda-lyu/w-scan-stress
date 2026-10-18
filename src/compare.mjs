// 對照:比較兩次 k6 之彙總(summary.json), 輸出前後對照之文字(改善倍數、門檻由 ✗ 轉 ✓ 之項目);
// 分組與計時皆取自兩次之彙總本身; 兩次須為相同參數(相同在線人數、持續時間、情境)才可直接對照
import fs from 'node:fs'
import { GATE_METRICS } from './config.mjs'
import { namesOf, timersOf } from './report.mjs'


const g = (m, k, s) => (m[k] && m[k].values) ? m[k].values[s] : null
const ms = (v) => (v === null || v === undefined) ? '-' : (v >= 1000 ? (v / 1000).toFixed(2) + 's' : Math.round(v) + 'ms')
const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)
const uniq = (a, b) => [...new Set([...a, ...b])]


/**
 * 改善倍數之文字
 *
 * @param {Number} a 輸入前值
 * @param {Number} b 輸入後值
 * @param {Boolean} [lower=true] 輸入是否數值越小越好(延遲為true、吞吐為false)，預設true
 * @returns {String} 回傳改善、退步或持平之文字
 */
export function ratio(a, b, lower = true) {
    if (a === null || b === null || a === undefined || b === undefined || a === 0 || b === 0) return '-'
    const r = lower ? a / b : b / a
    if (r >= 1.05) return `${r.toFixed(2)}x 改善`
    if (r <= 0.95) return `${(1 / r).toFixed(2)}x 退步`
    return '持平'
}


/**
 * 比較兩次結果
 *
 * @param {String} fpA 輸入前次summary.json路徑字串
 * @param {String} fpB 輸入後次summary.json路徑字串
 * @param {Object} [opt={}] 輸入設定物件
 * @param {String} [opt.labA='前'] 輸入前次之標籤字串
 * @param {String} [opt.labB='後'] 輸入後次之標籤字串
 * @param {Object} [opt.labels={}] 輸入請求分組與計時之顯示名稱物件
 * @returns {String} 回傳對照文字
 */
export function buildCompare(fpA, fpB, opt = {}) {
    const labA = opt.labA || '前'
    const labB = opt.labB || '後'
    const labels = opt.labels || {}
    const [A, B] = [fpA, fpB].map((fp) => {
        const m = JSON.parse(fs.readFileSync(fp, 'utf8')).metrics
        if (!m || typeof m !== 'object') throw new Error(`彙總內無 metrics(非 k6 之 summary.json?):${fp}`)
        return m
    })
    const out = []
    const p = (s = '') => out.push(s)

    p(`${labA}: ${fpA}`)
    p(`${labB}: ${fpB}`)
    p()
    p('=== 整體 ===')
    p(pad('指標', 20) + padL(labA, 12) + padL(labB, 12) + '   對照')
    const rows = [
        ['請求數 req/s', 'http_reqs', 'rate', false, (v) => (v || 0).toFixed(1)],
        ['完成趟數 趟/秒', 'iterations', 'rate', false, (v) => (v || 0).toFixed(3)],
        ['失敗率 %', 'http_req_failed', 'rate', true, (v) => ((v || 0) * 100).toFixed(2)],
        ['內容檢核失敗 %', 'app_errors', 'rate', true, (v) => ((v || 0) * 100).toFixed(2)],
        ['最高同時VU', 'vus_max', 'max', true, (v) => String(v || 0)],
    ]
    for (const [name, k, s, lower, fmt] of rows) {
        const a = g(A, k, s)
        const b = g(B, k, s)
        p(pad(name, 20) + padL(fmt(a), 12) + padL(fmt(b), 12) + '   ' + ratio(a, b, lower))
    }
    for (const s of ['med', 'p(90)', 'p(95)', 'max']) {
        const a = g(A, 'http_req_duration', s)
        const b = g(B, 'http_req_duration', s)
        p(pad('整體延遲 ' + s, 20) + padL(ms(a), 12) + padL(ms(b), 12) + '   ' + ratio(a, b, true))
    }
    for (const t of uniq(timersOf(A), timersOf(B))) {
        for (const s of ['med', 'p(95)', 'max']) {
            const a = g(A, t, s)
            const b = g(B, t, s)
            p(pad(`${labels[t] || t} ${s}`, 20) + padL(ms(a), 12) + padL(ms(b), 12) + '   ' + ratio(a, b, true))
        }
    }
    p()

    const names = uniq(namesOf(A), namesOf(B))
    p('=== 各分組 p95 ===')
    p(pad('分組', 20) + padL(labA, 12) + padL(labB, 12) + '   對照')
    const none = (v) => !v || !v.count
    for (const n of names) {
        const k = `http_req_duration{name:${n}}`
        const av = A[k] && A[k].values
        const bv = B[k] && B[k].values
        if (none(av) && none(bv)) continue
        if (none(av) || none(bv)) {
            p(pad(n, 20) + padL(none(av) ? '(未發出)' : ms(av['p(95)']), 12) + padL(none(bv) ? '(未發出)' : ms(bv['p(95)']), 12) + '   (無法對照)')
            continue
        }
        p(pad(n, 20) + padL(ms(av['p(95)']), 12) + padL(ms(bv['p(95)']), 12) + '   ' + ratio(av['p(95)'], bv['p(95)'], true))
    }
    p()

    p('=== 門檻 ===')
    for (const n of names) {
        const k = `http_req_duration{name:${n}}`
        const ta = A[k] && A[k].thresholds ? Object.values(A[k].thresholds)[0] : null
        const tb = B[k] && B[k].thresholds ? Object.values(B[k].thresholds)[0] : null
        if (!ta || !tb) continue //任一方無門檻結果(如該分組未發出)無法對照, 不判為改善或退步
        const sa = ta.ok ? '✓' : '✗'
        const sb = tb.ok ? '✓' : '✗'
        if (sa === sb) continue
        p(`  ${pad(n, 20)} ${labA}=${sa}  ${labB}=${sb}  ${sa === '✗' && sb === '✓' ? '<= 已改善' : '<= 已退步'}`)
    }
    for (const k of GATE_METRICS) {
        const ta = A[k] && A[k].thresholds
        const tb = B[k] && B[k].thresholds
        if (!ta || !tb) continue
        for (const t of Object.keys(ta)) {
            if (!tb[t]) continue
            p(`  安全閘 ${pad(k + ' ' + t, 34)} ${labA}=${ta[t].ok ? '未觸發' : '觸發'}  ${labB}=${tb[t].ok ? '未觸發' : '觸發'}`)
        }
    }
    return out.join('\n')
}
