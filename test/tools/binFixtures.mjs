// 外部執行檔測試用之夾具: 製作 zip(以 Windows 內建 bsdtar, 與 wsemi 解壓所用者同一工具)、計算 sha256、遞迴列檔、暫時設定環境變數
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'


const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar'


/**
 * 製作 zip 並回傳其位元組
 *
 * @param {String} fdWork 輸入暫存資料夾路徑字串(先清空再使用，結束後保留，由呼叫端刪除)
 * @param {Object} files 輸入以 zip 內路徑為鍵、內容(Buffer 或字串)為值之物件
 * @returns {Buffer} 回傳 zip 之位元組
 */
export function makeZip(fdWork, files) {
    fs.rmSync(fdWork, { recursive: true, force: true })
    const src = path.join(fdWork, 'zipsrc')
    for (const [rel, content] of Object.entries(files)) {
        const fp = path.join(src, ...rel.split('/'))
        fs.mkdirSync(path.dirname(fp), { recursive: true })
        fs.writeFileSync(fp, content)
    }
    const zip = path.join(fdWork, 'out.zip')
    const tops = [...new Set(Object.keys(files).map((v) => v.split('/')[0]))]
    const r = spawnSync(TAR, ['-a', '-cf', zip, '-C', src, ...tops], { encoding: 'utf8', windowsHide: true })
    if (r.status !== 0) throw new Error(`tar failed: ${r.stderr || r.error}`)
    return fs.readFileSync(zip)
}


/**
 * 計算位元組之 sha256 與大小
 *
 * @param {Buffer} buf 輸入位元組
 * @returns {Object} 回傳{sha256,size}
 */
export function hashBuf(buf) {
    return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length }
}


/**
 * 計算檔案之 sha256 與大小
 *
 * @param {String} fp 輸入檔案路徑字串
 * @returns {Object} 回傳{sha256,size}
 */
export function hashFile(fp) {
    return hashBuf(fs.readFileSync(fp))
}


/**
 * 遞迴列出資料夾內所有檔案之絕對路徑(排序)，資料夾不存在則回傳空陣列
 *
 * @param {String} fd 輸入資料夾路徑字串
 * @returns {Array} 回傳檔案路徑陣列
 */
export function listFiles(fd) {
    if (!fs.existsSync(fd)) return []
    return fs.readdirSync(fd, { recursive: true, withFileTypes: true }).filter((v) => v.isFile()).map((v) => path.join(v.parentPath, v.name)).sort()
}


/**
 * 同長度但內容不同之副本(翻轉指定位置之位元組)
 *
 * @param {Buffer} buf 輸入位元組
 * @param {Number} [i=10] 輸入翻轉之位置
 * @returns {Buffer} 回傳副本
 */
export function flip(buf, i = 10) {
    const b = Buffer.from(buf)
    b[i] = b[i] ^ 0xff
    return b
}


/**
 * 暫時設定環境變數(值為 undefined 代表刪除)，執行 fun，結束後還原
 *
 * @param {Object} vars 輸入環境變數鍵值物件
 * @param {Function} fun 輸入要執行之函數(可為 async)
 * @returns {Promise} 回傳 fun 之結果
 */
export async function withEnv(vars, fun) {
    const old = {}
    for (const k of Object.keys(vars)) {
        old[k] = process.env[k]
        if (vars[k] === undefined) delete process.env[k]
        else process.env[k] = vars[k]
    }
    try {
        return await fun()
    }
    finally {
        for (const k of Object.keys(vars)) {
            if (old[k] === undefined) delete process.env[k]
            else process.env[k] = old[k]
        }
    }
}
