// 壓測工具(k6)下載:同 w-scan-vulnerability、w-scan-dep,自 GitHub latest release 取當前最新版之 Windows 執行檔,依版本快取;
// 已存在對應版本之 exe(含 zip 解壓後位於子資料夾者)即略過下載。zip 資產以 Windows 內建 bsdtar 解壓。
// 下載與解壓於暫存夾進行,完成後才改名為正式版本夾(同 w-scan-dep 之 installVerDir):中斷或失敗不留殘缺執行檔。
// 無外網(查詢失敗)或指定不連網時, 沿用工具資料夾內已快取之最新版本, 使內網環境可預先放置執行檔後使用。
import { mkdir, writeFile, access, rm, readdir, rename, rmdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'


// GitHub API 之請求標頭(未驗證時每小時 60 次, 每個工具查詢 1 次)
const GH_HEADERS = { 'User-Agent': 'w-scan-stress', 'Accept': 'application/vnd.github+json' }

// Windows 內建 bsdtar(可解 zip);不用 git 的 GNU tar(不支援 zip)
const BSDTAR = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')

// 版本夾之上層內之暫存夾名稱(不視為版本)
const TMP_NAME = '.tmp'


const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


/**
 * 判斷檔案或資料夾是否存在
 *
 * @param {String} p 輸入檔案或資料夾路徑字串
 * @returns {Promise} 回傳Promise，resolve回傳是否存在布林值
 */
async function exists(p) {
    try {
        await access(p); return true
    }
    catch {
        return false
    }
}


/**
 * 查詢GitHub儲存庫之最新release
 *
 * @param {String} repo 輸入GitHub儲存庫字串，例如'grafana/k6'
 * @returns {Promise} 回傳Promise，resolve回傳release物件(含tag_name與assets)，reject回傳錯誤訊息
 */
async function fetchLatestRelease(repo) {
    const url = `https://api.github.com/repos/${repo}/releases/latest`
    const res = await fetch(url, { headers: GH_HEADERS })
    if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`GitHub API ${res.status} for ${repo}: ${body.slice(0, 200)}`)
    }
    return res.json()
}


/**
 * 下載檔案並寫入指定路徑
 *
 * @param {String} url 輸入下載網址字串
 * @param {String} dest 輸入寫入之檔案路徑字串
 * @returns {Promise} 回傳Promise，resolve回傳下載之位元組數，reject回傳錯誤訊息
 */
async function downloadTo(url, dest) {
    const res = await fetch(url, { headers: GH_HEADERS, redirect: 'follow' })
    if (!res.ok) throw new Error(`下載失敗 ${res.status}: ${url}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(dest, buf)
    return buf.length
}


/**
 * 於資料夾內遞迴尋找指定檔名之檔案
 *
 * @param {String} dir 輸入資料夾路徑字串
 * @param {String} name 輸入檔名字串
 * @returns {Promise} 回傳Promise，resolve回傳第一個符合之檔案路徑字串，找不到則回傳null
 */
async function findFile(dir, name) {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name)
        if (ent.isDirectory()) {
            const sub = await findFile(p, name)
            if (sub) return sub
        }
        else if (ent.name === name) {
            return p
        }
    }
    return null
}


/**
 * 以Windows內建bsdtar解壓zip，並回傳解壓資料夾內第一個符合exeName之執行檔路徑
 *
 * @param {String} zipPath 輸入zip檔路徑字串
 * @param {String} destDir 輸入解壓目的資料夾路徑字串
 * @param {String} exeName 輸入執行檔名稱字串
 * @returns {Promise} 回傳Promise，resolve回傳執行檔路徑字串，reject回傳錯誤訊息
 */
async function unzipAndFindExe(zipPath, destDir, exeName) {
    const r = spawnSync(BSDTAR, ['-xf', zipPath, '-C', destDir], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`解壓失敗 (${BSDTAR}): ${r.stderr || r.error?.message}`)
    const direct = join(destDir, exeName)
    if (await exists(direct)) return direct
    const found = await findFile(destDir, exeName)
    if (!found) throw new Error(`解壓後找不到 ${exeName} 於 ${destDir}`)
    return found
}


/**
 * 版本資料夾內之執行檔(zip解壓後可能位於子資料夾，例如k6-v2.2.0-windows-amd64/k6.exe)
 *
 * @param {String} verDir 輸入版本資料夾路徑字串
 * @param {String} exeName 輸入執行檔名稱字串
 * @returns {Promise} 回傳Promise，resolve回傳執行檔路徑字串，無則回傳null
 */
export async function findCachedExe(verDir, exeName) {
    if (!await exists(verDir)) return null
    return findFile(verDir, exeName)
}


/**
 * 比較版本字串(如'v2.2.0')，供由新至舊排序
 *
 * @param {String} a 輸入版本字串
 * @param {String} b 輸入版本字串
 * @returns {Number} 回傳b減a之比較值
 */
export function cmpVerDesc(a, b) {
    const pa = String(a).replace(/^v/, '').split('.').map((v) => parseInt(v, 10) || 0)
    const pb = String(b).replace(/^v/, '').split('.').map((v) => parseInt(v, 10) || 0)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pb[i] || 0) - (pa[i] || 0)
        if (d !== 0) return d
    }
    return 0
}


/**
 * toolsDir內已快取之最新版本(供無外網時沿用)，暫存夾不視為版本
 *
 * @param {Object} tool 輸入工具定義物件
 * @param {String} toolsDir 輸入工具存放資料夾路徑字串
 * @returns {Promise} 回傳Promise，resolve回傳{version,exePath}，無則回傳null
 */
export async function findLatestCached(tool, toolsDir) {
    const fd = join(toolsDir, tool.key)
    if (!await exists(fd)) return null
    const vers = (await readdir(fd, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name !== TMP_NAME).map((e) => e.name).sort(cmpVerDesc)
    for (const v of vers) {
        const exePath = await findCachedExe(join(fd, v), tool.exeName)
        if (exePath) return { version: v, exePath }
    }
    return null
}


/**
 * 將下載完成之暫存夾改名為正式版本夾(同w-scan-dep之installVerDir)
 *
 * 多程序共用toolsDir同時下載同版本時先改名者勝出；Windows防毒短暫鎖定剛寫入之執行檔致改名回EPERM、EACCES、EBUSY時重試；目標已存在時Windows亦回EPERM，故每次先判斷版本夾現況
 *
 * @param {String} tmpDir 輸入暫存夾路徑字串
 * @param {String} verDir 輸入正式版本夾路徑字串
 * @param {String} exeRel 輸入執行檔相對於版本夾之路徑字串
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Boolean} [opt.force=false] 輸入是否強制取代既有版本夾布林值
 * @param {Number} [opt.timeout=15000] 輸入重試之時限毫秒數
 * @returns {Promise} 回傳Promise，resolve回傳是否由本次放入布林值(false表示他程序已先完成，沿用之)，reject回傳錯誤訊息
 */
export async function installVerDir(tmpDir, verDir, exeRel, { force = false, timeout = 15000 } = {}) {
    const t0 = Date.now()
    for (let i = 0; ; i++) {
        try {
            await rename(tmpDir, verDir)
            return true
        }
        catch (e) {
            if (!force && await exists(join(verDir, exeRel))) return false
            if (Date.now() - t0 > timeout) throw e
            if (await exists(verDir)) {
                //無執行檔之殘缺版本夾, 或 force 重抓
                await rm(verDir, { recursive: true, force: true })
            }
            else if (['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) {
                await sleep(Math.min(200, 20 * (i + 1)))
            }
            else {
                throw e
            }
        }
    }
}


/**
 * 確保單一工具就緒：查詢最新版，toolsDir內已有該版執行檔即略過下載，否則下載(zip則解壓)至toolsDir/工具鍵名/版本；
 * 無法連網(查詢失敗)或給予opt.offline時，沿用toolsDir內已快取之最新版本，皆無則拋錯
 *
 * @param {Object} tool 輸入工具定義物件，見config.mjs之TOOLS
 * @param {Object} opt 輸入設定物件
 * @param {String} opt.toolsDir 輸入工具存放資料夾路徑字串
 * @param {Boolean} [opt.force=false] 輸入是否強制重新下載布林值，預設false
 * @param {Boolean} [opt.offline=false] 輸入是否不連網(只用已快取之版本)布林值，預設false
 * @param {Function} [opt.log=console.log] 輸入訊息輸出函數，預設console.log
 * @returns {Promise} 回傳Promise，resolve回傳工具資訊物件{key,version,exePath,cached}，cached為是否沿用快取，reject回傳錯誤訊息
 */
export async function ensureTool(tool, { toolsDir, force = false, offline = false, log = console.log }) {
    let rel = null
    if (!offline) {
        log(`[${tool.key}] 查詢最新版本...`)
        try {
            rel = await fetchLatestRelease(tool.repo)
        }
        catch (err) {
            log(`[${tool.key}] 無法查詢最新版本(${err.message}),改用已快取之版本`)
        }
    }
    if (!rel) {
        const c = await findLatestCached(tool, toolsDir)
        if (!c) throw new Error(`[${tool.key}] 無法連網取得, 且 ${join(toolsDir, tool.key)} 內無已快取之版本; 請將 ${tool.exeName} 置於 ${join(toolsDir, tool.key, '<版本>')} 內, 或另行指定執行檔之路徑`)
        log(`[${tool.key}] 沿用已快取之 ${c.version}`)
        return { key: tool.key, version: c.version, exePath: c.exePath, cached: true }
    }
    const version = rel.tag_name || 'unknown'
    const verDir = join(toolsDir, tool.key, version)

    const cached = force ? null : await findCachedExe(verDir, tool.exeName)
    if (cached) {
        log(`[${tool.key}] 已有最新版 ${version}(快取),略過下載`)
        return { key: tool.key, version, exePath: cached, cached: true }
    }

    const asset = (rel.assets || []).find((a) => tool.matchAsset(a.name))
    if (!asset) throw new Error(`[${tool.key}] ${version} 找不到符合的 Windows 資產`)

    //暫存夾置於 <工具>/.tmp/ 下, 不與版本夾並列, 避免被當成某一版本
    const tmpRoot = join(toolsDir, tool.key, TMP_NAME)
    const tmpDir = join(tmpRoot, `${version}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    await mkdir(tmpDir, { recursive: true })
    try {
        log(`[${tool.key}] 下載 ${asset.name} (${version}) ...`)
        let tmpExe
        if (tool.kind === 'zip') {
            const zipPath = join(tmpDir, asset.name)
            const bytes = await downloadTo(asset.browser_download_url, zipPath)
            log(`[${tool.key}] 下載完成 ${(bytes / 1048576).toFixed(1)}MB,解壓中...`)
            tmpExe = await unzipAndFindExe(zipPath, tmpDir, tool.exeName)
            await rm(zipPath, { force: true })
        }
        else {
            tmpExe = join(tmpDir, tool.exeName)
            const bytes = await downloadTo(asset.browser_download_url, tmpExe)
            log(`[${tool.key}] 下載完成 ${(bytes / 1048576).toFixed(1)}MB`)
        }
        const exeRel = relative(tmpDir, tmpExe)
        if (!await installVerDir(tmpDir, verDir, exeRel, { force })) {
            log(`[${tool.key}] ${version} 已由其他程序先完成下載,沿用之`)
        }
        return { key: tool.key, version, exePath: join(verDir, exeRel), cached: false }
    }
    finally {
        await rm(tmpDir, { recursive: true, force: true }) //改名成功後已不存在, 失敗時清除
        await rmdir(tmpRoot).catch(() => {}) //空了才刪; 他程序仍在下載時非空, 略過
    }
}


/**
 * 依序確保所有工具就緒
 *
 * @param {Array} tools 輸入工具定義物件陣列，見config.mjs之TOOLS
 * @param {Object} opt 輸入設定物件，同ensureTool之opt
 * @returns {Promise} 回傳Promise，resolve回傳以工具鍵名為鍵之物件，例如{k6:{key,version,exePath,cached}}，reject回傳錯誤訊息
 */
export async function ensureAllTools(tools, opt) {
    const out = {}
    for (const t of tools) {
        out[t.key] = await ensureTool(t, opt)
    }
    return out
}
