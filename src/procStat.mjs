// 資源記錄:各服務(依埠找監聽之行程)之累計處理器時間與記憶體, 以及整機之處理器使用率與記憶體(含 k6 本身)
// 僅支援 Windows(netstat、tasklist)
import os from 'node:os'
import { execSync } from 'node:child_process'


// netstat 於施壓時(大量連線、TIME_WAIT)之輸出可達數 MB, 預設 maxBuffer(1MB)會 ENOBUFS 而靜默得到空結果; stderr 不外洩至主控台
const EXEC_OPT = { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }


/**
 * 以netstat取監聽指定埠之行程PID
 *
 * @param {Number} port 輸入埠號，須為1~65535之整數
 * @returns {String} 回傳PID字串，找不到或埠號不合法則回傳''
 */
export function pidOfPort(port) {
    const n = Number(port)
    if (!Number.isInteger(n) || n < 1 || n > 65535) return ''
    try {
        const out = execSync('netstat -ano', EXEC_OPT)
        for (const ln of out.split(/\r?\n/)) {
            const m = new RegExp(`^\\s*TCP\\s+\\S+:${n}\\s+\\S+\\s+LISTENING\\s+(\\d+)`).exec(ln)
            if (m) return m[1]
        }
    }
    catch {
        return ''
    }
    return ''
}


/**
 * 以tasklist取行程之記憶體(工作集，MB)與累計處理器時間(秒)，欄位依位置取(不依語系之欄名)
 *
 * @param {String} pid 輸入PID字串
 * @returns {Object|null} 回傳{pid,memMb,cpuSec}，取不到則回傳null
 */
export function procStat(pid) {
    if (!/^\d+$/.test(String(pid))) return null
    try {
        const out = execSync(`tasklist /V /FO CSV /NH /FI "PID eq ${pid}"`, EXEC_OPT)
        const cols = [...out.matchAll(/"([^"]*)"/g)].map((m) => m[1])
        if (cols.length < 8) return null
        const memMb = Number(cols[4].replace(/[^\d]/g, '')) / 1024
        const [h, mi, s] = cols[7].split(':').map(Number)
        return { pid, memMb: Math.round(memMb), cpuSec: h * 3600 + mi * 60 + s }
    }
    catch {
        return null
    }
}


/**
 * 依行程之埠取各行程之資源
 *
 * @param {Object} kpSvcPort 輸入行程鍵名對埠號之物件，例如{api:8000,auth:8001}
 * @returns {Object} 回傳行程鍵名對{pid,memMb,cpuSec}之物件，取不到者為null
 */
export function snapProcs(kpSvcPort) {
    const r = {}
    for (const k of Object.keys(kpSvcPort)) {
        r[k] = procStat(pidOfPort(kpSvcPort[k]))
    }
    return r
}


/**
 * 開始每秒取樣整機之處理器使用率(%)與記憶體使用量(GB)，回傳停止函數，呼叫後回傳取樣陣列[{t,cpu,memGb}]
 *
 * @returns {Function} 回傳停止取樣之函數
 */
export function startSampler() {
    const cpuTimes = () => os.cpus().reduce((a, c) => {
        const t = c.times
        a.idle += t.idle
        a.total += t.user + t.nice + t.sys + t.idle + t.irq
        return a
    }, { idle: 0, total: 0 })
    const samples = []
    let prev = cpuTimes()
    const tm = setInterval(() => {
        const cur = cpuTimes()
        const dt = cur.total - prev.total
        const cpu = dt > 0 ? (1 - (cur.idle - prev.idle) / dt) * 100 : 0
        prev = cur
        samples.push({ t: Date.now(), cpu: Math.round(cpu), memGb: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024 / 102.4) / 10 })
    }, 1000)
    return () => {
        clearInterval(tm)
        return samples
    }
}
