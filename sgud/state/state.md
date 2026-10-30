# 現況(state)

本檔只記現況(各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證),不寫過程(過程寫入 `sgud/exp/experience.md`).接續工作先讀本檔.

## 功能現況

| 功能 | 狀態 | 規則帳本 | 測試檔 |
| --- | --- | --- | --- |
| 壓力測試主函數 `WScanStress(fdOut, opt)`(逐級施壓、安全閘、session、遮蔽、報告) | 完成 | R01、R03、R04、R05、R06、R13 | `unit-WScanStress`、`unit-config`、`unit-scenario`、`unit-k6`、`unit-procStat`、`unit-report`、`unit-compare` |
| **依埠找監聽行程(`procPorts` 之資源記錄)**:`src/procStat.mjs` 之 `pidOfPort`/`snapProcs`/`listSnapErrors` | 完成(2026-10-30):經 wsemi 1.9.32 `execProcessPortPidsSync`(netstat 查無再 `Get-NetTCPConnection`,不依狀態欄);`pidOfPort` 回 PID 數字陣列,失敗拋錯;`snapProcs` 失敗記 `{ error }`,日誌/`sys.json`/報告皆列;多 PID 取最小者;每埠每次查詢約 1 秒(本機 OS) | R15、R05、R13 | `unit-procStat`、`unit-report`、`unit-WScanStress` |
| 瀏覽器擷取 `src/capture.mjs` | 完成(不在 `dist` 內) | — | `unit-capture`(需 playwright 之 chromium) |
| 文件與程式同步(README、jsdoc、`g.mjs`、opt 鍵) | 完成 | R12 | `unit-docs` |
| **外部執行檔 k6.exe 之存放、下載、校驗與離線**(制式規格 `C:\opensrcOper\dspec\外部執行檔之存放下載校驗與離線.md`) | 完成(2026-10-29):C 類、主幹模式;`bin/manifest.json` 記 k6 v2.3.0 版本標籤資產網址與校驗值;`src/ensureBins.mjs` 轉呼叫 wsemi 1.9.27 `fsEnsureBins`;`WScanStress` 經它取得 k6;已移除 `src/download.mjs`、`fdTools`、`TOOLS` | R14、R11、R09 | `unit-binManifest`、`api-ensureBins`、`unit-genBinManifest`、`unit-WScanStress`(末案:真 k6 經鏡像取得) |
| k6 版本更新工具 `toolg/genBinManifest.mjs`(`--tag`、`--dry`) | 完成;已連網實跑:v2.3.0,乾跑 unchanged | R14 | `unit-genBinManifest` |

## 已知缺口與待辦

- `CLAUDE.md`(本套件根,代理不得改)仍描述舊制:§1 之 `fdTools`/`src/download.mjs`/「預設自 GitHub latest release 下載」、§2 之 GitHub API 額度、§3、§4 錯誤訊息表(舊的 `[k6] 無法連網取得…`、`GitHub API <狀態碼>`)、§8 不可放寬表之行號(`src/WScanStress.mjs:185-186、210、216-227、340-358` 等已位移,`ensureAllTools`/`k6Version` 位置改變)、§9 之模組清單(含 `download.mjs`)與 `npm test` 會下載 k6、埠清單(新增 8094、8095).須由主控或使用者更新(已列入報告〈待裁示〉).
- 實跑所需之 k6 取自快取:新複製之 repo 須於可連網環境執行一次 `ensureBins()` 暖 `bin-cache/`(見 experience);否則 `unit-WScanStress` 之實跑與「經鏡像取得」案略過(印出提示).
- 清單對真實廠商檔之正確性:測試不連網,故只由 `toolg/genBinManifest.mjs`(產生時核對廠商 checksums)與首次真實使用(2026-10-29 實測)保證;`bin/manifest.json` 之校驗值不在測試中硬編(避免指紋測試).
- wsemi 尚未實作項(規格 §6 E4):鏡像 `manifest-last.json` 退路、雜湊不符重取主幹清單、檔案組(本套件不需).主幹清單取不到時現行為直接用包內基準清單.
- `docs/`(jsdoc 輸出)含已移除之 `download.mjs.html`:由發布流程重產,不手動動.

- 依埠找行程:`tasklist` 取不到(`procStat` 回 `null`)仍與「無人監聽」同為 `null`(不涉 TCP 狀態,未改);Linux/macOS 不在範圍(本套件僅 Windows).每次查詢約 1 秒屬 wsemi 在本機 OS 上的實測(netstat 查無 → PowerShell 冷啟動),無法在本套件內縮短.
- `README.md`〈Breaking changes〉已記 `pidOfPort`/`snapProcs`/`sys.json` 之介面改變(內部模組,不經主函數匯出);`CLAUDE.md` 之 §8 表(`src/procStat.mjs:7-8,19`「`maxBuffer` 放大、埠號須為整數」)描述的是舊 `pidOfPort`,現 `netstat` 不由本套件執行(R15),須由主控或使用者更新(代理不得改 `CLAUDE.md`).

## 最近一次驗證

- 2026-10-30(stress01,依埠找行程改 wsemi):修前紅(舊 `pidOfPort` 對自己的監聽 0/15)→ 修後綠(15/15);`unit-procStat`/`unit-report`/`unit-WScanStress` 通過;變異與全套 `npm test` 結果見報告 `C:\opensrcOper\dnow\20261030064553\agent-out\stress01-修正報告.md`.未發布(版本仍為 1.0.3 之 `package.json`,發布為使用者作業).

- 2026-10-29(bin-scanstress):新測試 `unit-binManifest`、`api-ensureBins`、`unit-genBinManifest`、`unit-docs` 與 `unit-WScanStress` 通過;變異 24 項全被殺;真實連網首次使用(主幹清單 404 → 退基準清單 → 下載 zip → 解出 → 校驗)4.7 秒;`node C:/opensrcOper/tools/scan-bins.mjs --only w-scan-stress` 為 OK;全套 `npm test` 結果見報告.
- 未發布:版本仍為 1.0.2(發布為使用者作業);`dist` 不於本輪重產(以 `tmp/` 內之打包副本驗證 UMD:`require` 得函數、`.ensureBins` 為函數、打包後之 `fsEnsureBins` 可用).
