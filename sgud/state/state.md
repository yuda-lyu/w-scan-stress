# 現況(state)

本檔只記現況(各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證),不寫過程(過程寫入 `sgud/exp/experience.md`).接續工作先讀本檔.

## 功能現況

| 功能 | 狀態 | 規則帳本 | 測試檔 |
| --- | --- | --- | --- |
| 壓力測試主函數 `WScanStress(fdOut, opt)`(逐級施壓、安全閘、session、遮蔽、報告) | 完成 | R01、R03、R04、R05、R06、R13 | `unit-WScanStress`、`unit-config`、`unit-scenario`、`unit-k6`、`unit-procStat`、`unit-report`、`unit-compare` |
| **依埠找監聽行程(`procPorts` 之資源記錄)**:`src/procStat.mjs` 之 `pidOfPort`/`snapProcs`/`listSnapErrors` | 完成(2026-10-30):經 wsemi 1.9.32 `execProcessPortPidsSync`(netstat 查無再 `Get-NetTCPConnection`,不依狀態欄);`pidOfPort` 回 PID 數字陣列,失敗拋錯;`snapProcs` 失敗記 `{ error }`,日誌/`sys.json`/報告皆列;多 PID 取最小者;每埠每次查詢約 1 秒(本機 OS) | R15、R05、R13 | `unit-procStat`、`unit-report`、`unit-WScanStress` |
| 瀏覽器擷取 `src/capture.mjs` | 完成(不在 `dist` 內);2026-11-13 起預設啟動點經 `w-playwright` 之 `launchChromium`(`dependencies` 為 `w-playwright ^1.0.1`,已移除 `playwright`;`playwright-core` 精確 1.64.1 由其帶入);啟動失敗為帶 `code` 之固定詞彙錯誤(`E_BROWSER_MISSING` 等);不自動下載;README〈擷取〉與 jsdoc 已寫安裝/離線/守門參數/Chrome、Edge 驗證狀態 | R16 | `unit-capture`(〈實擷〉3 案需受管 headless shell:`await wpw.ensureChromium()`;〈啟動經 w-playwright(接線)〉4 案以替身不啟動瀏覽器)、`unit-pwOnly` |
| 文件與程式同步(README、jsdoc、`g.mjs`、opt 鍵) | 完成 | R12 | `unit-docs` |
| **外部執行檔 k6.exe 之存放、下載、校驗與離線**(制式規格 `C:\opensrcOper\dspec\外部執行檔之存放下載校驗與離線.md`) | 完成(2026-10-29):C 類、主幹模式;`bin/manifest.json` 記 k6 v2.3.0 版本標籤資產網址與校驗值;`src/ensureBins.mjs` 轉呼叫 wsemi 1.9.27 `fsEnsureBins`;`WScanStress` 經它取得 k6;已移除 `src/download.mjs`、`fdTools`、`TOOLS` | R14、R11、R09 | `unit-binManifest`、`api-ensureBins`、`unit-genBinManifest`、`unit-WScanStress`(末案:真 k6 經鏡像取得) |
| k6 版本更新工具 `toolg/genBinManifest.mjs`(`--tag`、`--dry`) | 完成;已連網實跑:v2.3.0,乾跑 unchanged | R14 | `unit-genBinManifest` |

## 已知缺口與待辦

- `CLAUDE.md`(本套件根,代理不得改)仍描述舊制:§1 之 `fdTools`/`src/download.mjs`/「預設自 GitHub latest release 下載」、§2 之 GitHub API 額度、§3、§4 錯誤訊息表(舊的 `[k6] 無法連網取得…`、`GitHub API <狀態碼>`)、§8 不可放寬表之行號(`src/WScanStress.mjs:185-186、210、216-227、340-358` 等已位移,`ensureAllTools`/`k6Version` 位置改變)、§9 之模組清單(含 `download.mjs`)與 `npm test` 會下載 k6、埠清單(新增 8094、8095).須由主控或使用者更新(已列入報告〈待裁示〉).
- 實跑所需之 k6 取自快取:新複製之 repo 須於可連網環境執行一次 `ensureBins()` 暖 `bin-cache/`(見 experience);否則 `unit-WScanStress` 之實跑與「經鏡像取得」案略過(印出提示).
- 清單對真實廠商檔之正確性:測試不連網,故只由 `toolg/genBinManifest.mjs`(產生時核對廠商 checksums)與首次真實使用(2026-10-29 實測)保證;`bin/manifest.json` 之校驗值不在測試中硬編(避免指紋測試).
- wsemi 尚未實作項(規格 §6 E4):鏡像 `manifest-last.json` 退路、雜湊不符重取主幹清單、檔案組(本套件不需).主幹清單取不到時現行為直接用包內基準清單.
- `docs/`(jsdoc 輸出)含已移除之 `download.mjs.html`:由發布流程重產,不手動動.
- `CLAUDE.md` 另有 2026-11-13 後之落差(代理不得改,待主控或使用者更新):§2「瀏覽器:僅 `src/capture.mjs` 需要(`playwright`)…`unit-capture.test.mjs` 需 playwright 之 chromium(`npx playwright install chromium`)」與 §9 模組/測試描述,現應為 `w-playwright`(受管 headless shell 以 `await wpw.ensureChromium()` 取得、不寫 `npx playwright install`);另宜在 §1 或 §9 補〈啟動一律經 w-playwright,不得直接引用 playwright/playwright-core(R16)〉.
- 未驗證項(誠實記錄):本套件的測試不啟動真 Chrome、Edge 或完整 Chromium,故 `browserChannel: 'chrome'|'msedge'` 只驗到「選項轉傳給 w-playwright」(接線測試),其守門生效與否依 `w-playwright` README〈驗證狀態〉(2026-11-13:Chrome 157.0.8103.78、Edge 157.0.4341.46 無頭已驗;有頭、beta/dev/canary 未驗);README 已如實轉述.

- 依埠找行程:`tasklist` 取不到(`procStat` 回 `null`)仍與「無人監聽」同為 `null`(不涉 TCP 狀態,未改);Linux/macOS 不在範圍(本套件僅 Windows).每次查詢約 1 秒屬 wsemi 在本機 OS 上的實測(netstat 查無 → PowerShell 冷啟動),無法在本套件內縮短.
- `README.md`〈Breaking changes〉已記 `pidOfPort`/`snapProcs`/`sys.json` 之介面改變(內部模組,不經主函數匯出);`CLAUDE.md` 之 §8 表(`src/procStat.mjs:7-8,19`「`maxBuffer` 放大、埠號須為整數」)描述的是舊 `pidOfPort`,現 `netstat` 不由本套件執行(R15),須由主控或使用者更新(代理不得改 `CLAUDE.md`).

## 最近一次驗證

- 2026-11-13(pm-ss,瀏覽器啟動改經 w-playwright,排程第 442 項):`node_modules/w-playwright` 為 1.0.1、`playwright-core` 為 1.64.1(精確);新增 `unit-pwOnly`(3 案)與 `unit-capture` 〈啟動經 w-playwright(接線)〉(4 案),修前 5 紅(以空 `PLAYWRIGHT_BROWSERS_PATH` 執行,未啟動任何瀏覽器)、修後綠;三項變異(改回直接引用 `playwright-core`、刪 `executablePath` 轉傳、刪 `channel` 轉傳)皆轉紅;全套 `npm test` 166 通過、0 失敗、0 略過(修前基線:排除〈實擷〉3 案為 156 通過);R-PW-ONLY 盤點 0 處;eslint 與 jsdoc 通過;測試前後登入錯誤次數 0→0(只啟動過受管 headless shell).`toolg/gDistRollup.mjs` 無需改動(`capture.mjs` 不在 `dist` 可達範圍).未發布.報告 `C:\opensrcOper\dnow\20261113103344\agent-out\pm-ss-修正報告.md`.

- 2026-11-02(pk-scan-stress,npm 包檢查對齊 dspec〈自有套件之npm發布範圍〉原則 2〈套件測試之 npm 包檢查〉①):`unit-binManifest` 之 npm 包案改為「不得入包」只列外部執行檔與壓縮檔等、改斷言 `sgud/state/state.md` 與 `test/tools/` 隨包(修前紅:舊斷言 `sgud/` 不在包內;修後綠);`.npmignore` 首段改為 `.gitignore` 逐行抄錄(入包清單前後同為 98 檔);變異(假 `.dll`/`.exe`、排除 `sgud`/`test/tools`、移除 `CLAUDE*.md` 列)皆紅;全套 `npm test` 159 通過.本套件無執行期大小上限斷言(`src/`+`dist/`+`bin/` 實測 392889 位元組),待主控裁定是否新增.報告 `C:\opensrcOper\dnow\20261102182000\agent-out\pk-scan-stress-修正報告.md`.未發布.

- 2026-10-30(stress01,依埠找行程改 wsemi):修前紅(舊 `pidOfPort` 對自己的監聽 0/15)→ 修後綠(15/15);`unit-procStat`/`unit-report`/`unit-WScanStress` 通過;變異與全套 `npm test` 結果見報告 `C:\opensrcOper\dnow\20261030064553\agent-out\stress01-修正報告.md`.未發布(版本仍為 1.0.3 之 `package.json`,發布為使用者作業).

- 2026-10-29(bin-scanstress):新測試 `unit-binManifest`、`api-ensureBins`、`unit-genBinManifest`、`unit-docs` 與 `unit-WScanStress` 通過;變異 24 項全被殺;真實連網首次使用(主幹清單 404 → 退基準清單 → 下載 zip → 解出 → 校驗)4.7 秒;`node C:/opensrcOper/tools/scan-bins.mjs --only w-scan-stress` 為 OK;全套 `npm test` 結果見報告.
- 未發布:版本仍為 1.0.2(發布為使用者作業);`dist` 不於本輪重產(以 `tmp/` 內之打包副本驗證 UMD:`require` 得函數、`.ensureBins` 為函數、打包後之 `fsEnsureBins` 可用).
