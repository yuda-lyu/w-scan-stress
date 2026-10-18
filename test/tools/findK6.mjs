// 找測試用之 k6 執行檔: 環境變數 K6_PATH, 其次 PATH 內之 k6.exe, 皆無則回傳 ''(此時由 WScanStress 自 GitHub 下載最新版)
import { spawnSync } from 'node:child_process'


/**
 * 找測試用之k6執行檔
 *
 * @returns {String} 回傳k6執行檔路徑字串，找不到則回傳''
 */
function findK6() {
    if (process.env.K6_PATH) return process.env.K6_PATH
    const r = spawnSync('where', ['k6.exe'], { encoding: 'utf8' })
    if (r.status !== 0) return ''
    return (r.stdout || '').split(/\r?\n/)[0].trim()
}


export default findK6
