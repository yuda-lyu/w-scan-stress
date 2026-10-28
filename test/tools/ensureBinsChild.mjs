// 子行程: 於他處工作目錄載入指定之 ensureBins 模組(argv[2], 絕對路徑)並離線呼叫, 印出一行 JSON { cwd, code, cachePath }
// 用於驗證套件根之判定與工作目錄無關(被安裝為相依套件時, 載入時之工作目錄為使用者專案而非套件根)
import { pathToFileURL } from 'node:url'


const mod = await import(pathToFileURL(process.argv[2]).href)
const err = await mod.default({ mirror: '', offline: true }).then(() => null, (e) => e)
console.log(JSON.stringify({
    cwd: process.cwd(),
    code: err && err.code,
    cachePath: err && err.missing && err.missing[0] && err.missing[0].cachePath,
}))
