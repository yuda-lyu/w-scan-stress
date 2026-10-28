// 找測試用之 k6 執行檔(皆不連網):
//   findK6: 環境變數 K6_PATH → PATH 內之 k6.exe → 本套件清單(bin/manifest.json)所載之 k6.exe 已在快取(或 W_BIN_MIRROR 鏡像)者, 皆無則回傳 ''
//   findVerifiedK6: 只取後者(經 ensureBins 離線取得並以清單校驗, 故其位元組即清單所載者), 供「經鏡像取得」之測試作為鏡像內之檔
// 快取為空時(新複製之 repo): 於可連網環境執行一次 `node -e "import('./src/ensureBins.mjs').then((m) => m.default())"`(首次使用時下載 k6 並校驗), 或設 W_BIN_MIRROR
import { spawnSync } from 'node:child_process'
import ensureBins from '../../src/ensureBins.mjs'


/**
 * 找經清單校驗之 k6 執行檔(只用快取與鏡像，不連網)
 *
 * @returns {Promise} 回傳Promise，resolve回傳k6.exe路徑字串，快取與鏡像皆無則回傳''
 */
export async function findVerifiedK6() {
    try {
        const bins = await ensureBins({ names: 'k6.exe', offline: true })
        return bins['k6.exe']
    }
    catch (err) {
        if (err && err.code === 'E_OFFLINE_MISSING') return ''
        throw err
    }
}


/**
 * 找測試用之k6執行檔
 *
 * @returns {Promise} 回傳Promise，resolve回傳k6執行檔路徑字串，找不到則回傳''
 */
async function findK6() {
    if (process.env.K6_PATH) return process.env.K6_PATH
    const r = spawnSync('where', ['k6.exe'], { encoding: 'utf8', windowsHide: true })
    if (r.status === 0) {
        const fp = (r.stdout || '').split(/\r?\n/)[0].trim()
        if (fp) return fp
    }
    return findVerifiedK6()
}


export default findK6
