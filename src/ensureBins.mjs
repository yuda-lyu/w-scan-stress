import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fsEnsureBins from 'wsemi/src/fsEnsureBins.mjs'


//pkgRoot, 本套件根目錄(以本檔位置推得, 不依賴工作目錄; src/與dist/皆位於套件根之下一層)
let pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')


/**
 * 取得本套件之外部執行檔k6.exe: 首次使用時自k6官方發布(版本標籤之資產網址，zip)下載(或自鏡像取得)並解出，以bin/manifest.json之SHA-256與大小校驗，之後自快取取得(亦校驗)
 *
 * 規格: 外部執行檔之存放下載校驗與離線(制式規格)§6；實作為wsemi之fsEnsureBins，本套件不另寫下載、快取、鏡像、校驗與解壓。
 * 本套件為主幹模式：執行時先取GitHub主幹之bin/manifest.json(最新清單)，取不到時用npm包內之基準清單。
 * 環境變數：W_BIN_CACHE、W_BIN_MIRROR、W_BIN_OFFLINE，見README〈外部執行檔〉
 *
 * @param {Object} [opt={}] 輸入設定物件，交wsemi之fsEnsureBins(names、cacheDir、mirror、offline、onProgress等)，pkgRoot固定為本套件根
 * @returns {Promise} 回傳Promise，resolve回傳{ [檔名]: 絕對路徑 }，reject回傳帶code之Error(E_OFFLINE_MISSING、E_HASH_MISMATCH、E_EXTRACT等)
 * @example
 * import ensureBins from 'w-scan-stress/src/ensureBins.mjs'
 *
 * async function test() {
 *
 *     //部署前預先取得(連網機器設W_BIN_CACHE=<資料夾>後執行，該資料夾即可作為離線鏡像W_BIN_MIRROR)
 *     let bins = await ensureBins()
 *
 *     console.log('bins', bins)
 *     // bins { 'k6.exe': 'D:\\xxx\\node_modules\\w-scan-stress\\bin-cache\\<sha256>\\k6.exe' }
 * }
 * test()
 *     .catch((err) => {
 *         console.log('catch', err)
 *     })
 *
 */
function ensureBins(opt = {}) {

    //floatingManifestUrl會改變清單之信任錨，不轉傳使用者之值(主幹模式之網址由清單之repo與manifestPath決定)
    let { floatingManifestUrl, ...o } = opt || {} // eslint-disable-line no-unused-vars

    return fsEnsureBins('bin/manifest.json', { ...o, pkgRoot })
}


export default ensureBins
