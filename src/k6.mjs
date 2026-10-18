// k6 之執行:取得本套件之 k6 腳本路徑與 k6 版本, 執行一級 k6(輸出同時寫入 k6.log), 判斷該級是否觸發安全閘
// 安全閘之判定只依 k6 腳本設定之三項中止門檻(見 config.mjs 之 GATE_METRICS), 各請求分組之 p95 門檻只供報告標示
import fs from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { GATE_METRICS } from './config.mjs'


/**
 * 取本套件k6腳本之路徑(src內執行時為同資料夾，自dist執行時為../src)
 *
 * @returns {String} 回傳k6腳本之絕對路徑字串，找不到則拋錯
 */
export function locateK6Script() {
    const here = dirname(fileURLToPath(import.meta.url))
    const cands = [join(here, 'k6Scenario.js'), join(here, '..', 'src', 'k6Scenario.js')]
    const fp = cands.find((p) => fs.existsSync(p))
    if (!fp) throw new Error(`找不到 k6 腳本: ${cands.join(', ')}`)
    return fp
}


/**
 * 取k6之版本字串，k6不存在或不可執行即拋錯
 *
 * @param {String} exe 輸入k6執行檔路徑字串
 * @returns {String} 回傳k6之版本字串
 */
export function k6Version(exe) {
    const r = spawnSync(exe, ['version'], { encoding: 'utf8', timeout: 30000 })
    if (r.error || r.status !== 0) throw new Error(`無法執行 k6:${exe}(${r.error ? r.error.message : `離開碼 ${r.status}`})`)
    return (r.stdout || '').trim()
}


/**
 * 執行一級k6，輸出同時寫入k6.log，回傳k6之離開碼
 *
 * @param {String} exe 輸入k6執行檔路徑字串
 * @param {String} fpScript 輸入k6腳本路徑字串
 * @param {Object} env 輸入帶入k6之環境變數物件
 * @param {String} fdLevel 輸入該級之輸出資料夾路徑字串
 * @param {Boolean} quiet 輸入是否不輸出至主控台布林值
 * @returns {Promise} 回傳Promise，resolve回傳離開碼，reject回傳錯誤訊息(k6無法啟動或k6.log無法寫入)
 */
export function runK6(exe, fpScript, env, fdLevel, quiet) {
    return new Promise((resolve, reject) => {
        let ch = null
        let settled = false
        const ws = fs.createWriteStream(join(fdLevel, 'k6.log'))
        //串流之 error 事件必須先掛上(含 spawn 同步失敗之路徑), 否則開檔失敗會成為未捕捉之例外
        ws.on('error', (err) => {
            if (ch) ch.kill()
            if (settled) return
            settled = true
            reject(new Error(`無法寫入 k6.log:${err.message}`))
        })
        //收尾: 關閉 k6.log 後才完成; 關閉時帶出之錯誤(如延後發生之開檔失敗)亦視為失敗, 不誤 resolve
        const settle = (done) => {
            if (settled) return
            settled = true
            ws.end((err) => {
                if (err) reject(new Error(`無法寫入 k6.log:${err.message}`))
                else done()
            })
        }
        try {
            ch = spawn(exe, ['run', fpScript], { env: { ...process.env, ...env } })
        }
        catch (err) {
            //Windows 對無法執行之檔案(如非執行檔)會同步拋錯(spawn UNKNOWN)
            settle(() => reject(new Error(`無法啟動 k6:${exe}(${err.message})`)))
            return
        }
        ch.stdout.on('data', (b) => {
            if (!quiet) process.stdout.write(b)
            ws.write(b)
        })
        ch.stderr.on('data', (b) => {
            if (!quiet) process.stderr.write(b)
            ws.write(b)
        })
        ch.on('error', (err) => {
            settle(() => reject(new Error(`無法啟動 k6:${exe}(${err.message})`)))
        })
        ch.on('close', (code) => {
            settle(() => resolve(code))
        })
    })
}


/**
 * 安全閘是否觸發(或無結果)
 *
 * 彙總不存在、內容無法解析(如k6被中斷而寫入不完整)、無metrics，或三項安全閘指標缺任一項之門檻結果，視為無結果，亦即觸發；
 * k6Scenario.js對三項指標皆設有門檻，k6完整結束時即使情境無任何請求(僅sleep)，彙總內仍有此三項
 *
 * @param {String} fpSummary 輸入該級summary.json路徑字串
 * @returns {Boolean} 回傳是否觸發布林值
 */
export function gateTriggered(fpSummary) {
    if (!fs.existsSync(fpSummary)) return true
    let m = null
    try {
        m = JSON.parse(fs.readFileSync(fpSummary, 'utf8')).metrics
    }
    catch {
        return true
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return true
    for (const k of GATE_METRICS) {
        const th = m[k] && m[k].thresholds
        if (!th || typeof th !== 'object' || Object.keys(th).length === 0) return true
        if (Object.values(th).some((t) => !t || !t.ok)) return true
    }
    return false
}
