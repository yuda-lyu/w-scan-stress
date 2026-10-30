# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

## 測試與執行

- **參數檢查類測試須帶「不存在之 k6Path」**(2026-10-18;2026-10-29 起不再下載,但仍有效):`WScanStress` 在參數檢核通過後會取得 k6 並真的施壓.第一版〈其餘參數格式有誤〉測試未帶 `k6Path`,`batchPerHost: 0` 被 `||` 當成未給而放行,於是測試下載 k6 並以預設級距(10 人,爬升 30s＋持續 3m)跑了 3.5 分鐘(情境僅 sleep,無任何網路流量).現所有〈拒收〉案皆帶 `k6Path: <不存在>`,漏檢核時以「指定之 k6 不存在」立即失敗.預設值判斷須用 `??` 而非 `||`,否則 0 被吞成預設而逃過檢核(`src/config.mjs` 之 `batchPerHost`、`gap`).
- **k6 取得(2026-10-29 改)**:測試不再下載 k6(測試不得連外網).`unit-WScanStress` 之實跑所需之 k6 依序取 `K6_PATH` → `PATH` 內之 `k6.exe` → 清單所載者已在快取/`W_BIN_MIRROR` 者(`test/tools/findK6.mjs`,經 `ensureBins({ offline: true })` 校驗);皆無則實跑略過並印提示.新複製之 repo 或換了 k6 版本後(`bin/manifest.json` 更新),須於可連網環境執行一次 `ensureBins()`(例:寫 `tmp/warm.mjs` import `src/ensureBins.mjs` 呼叫)暖快取 `bin-cache/`(不入 git/npm 包).2026-10-29 實測首次使用 4.7 秒(主幹清單 404 → 退基準清單 → 下載 30MB zip → 解出 → 校驗).
- `quiet-run` 以 cmd 執行指令,`node_modules/.bin/mocha` 這類路徑會被 cmd 當成內部指令而失敗,改用 `npx mocha …`(或 `node node_modules/mocha/bin/mocha.js …`).單檔跑法:`npx mocha --no-parallel test/unit-k6.test.mjs --timeout 180000`.eslint 同理用 `npx eslint src test g.mjs --ext .mjs`.
- `unit-WScanStress` 之實跑 `before` 會整個刪除 `test/_tmp/WScanStress`,故單獨重跑某個 `it` 時要連同 `before`(勿只 `--grep` 內層).k6 不再放在該夾(在 `bin-cache/` 或使用者指定處).
- **變異驗證放副本、不建連結、不動 repo**(2026-10-30):副本置 `./tmp/<夾>/mut/<id>/`(複製 `src`、`test`〔不含 `_tmp`〕、`package.json`、`bin/manifest.json`),`node_modules` 由上層 repo 逐層向上解析(不建 junction,清理免拆連結);測試用 cwd 相對路徑(`./test/fixtures`、`./test/_tmp`),故以副本為 cwd 執行 `node <repo>/node_modules/mocha/bin/mocha.js`;實跑 k6 之測試設環境變數 `K6_PATH=<bin-cache 內之 k6.exe>`(副本無 `bin-cache`,否則實跑略過而變異假存活);全部變異放同一個腳本、一次 `quiet-run --lock` 取放.
- **取修改前之檔**:`git archive HEAD <路徑> --output=./tmp/<夾>/old.tar` 後 `tar -C ./tmp/<夾>/old -xf ./tmp/<夾>/old.tar`(Git Bash 的 GNU tar 把 `C:` 當主機名,須用相對路徑);勿用 `git show … > 檔`(寫檔重導向被守門擋下).
- 驗證「修前紅」可用修改前打包之 `dist`(發布流程產的 `dist` 即舊碼)寫 `tmp/` 腳本重現,免 git stash/checkout(本專案禁用).例:`k6Path` 給 `process.execPath`(修改前不檢查 k6 可否執行),使流程走到 `finally`,可重現「`releaseSessions` 拋錯遮蓋原始錯誤且遺失 session」.

- **外審有價值且要看實跑**(2026-10-18 第 1 次對齊):sol(`gpt-6.1-sol`/max,約 21 分鐘)30 條中 26 條屬實、0 誤報,多為併發、`finally` 清理順序、遮蔽失敗路徑、gate 空 metrics、capture 競態這類「自審一定漏」的格;beam(`opencode/beam-free`,2 分鐘)抓到除零、缺值、對稱性等邊界.派工時給「失敗點 × 須收拾項目」輸入空間表要審查者挑戰,效果好.審查者之建議須自行驗證:sol 暗示時間格式採 Go `ParseDuration` 全集,實測 k6 拒收 `1w` 卻接受 `1d`、`.5s`、`100us`.
- **驗證 k6 接受之格式用 `k6 inspect <腳本>`**(不真的跑):`export let options = { scenarios: { a: { executor: 'ramping-vus', stages: [{ target: 1, duration: '<值>' }] } } }`,能印出 options 即接受,拋 `could not initialize` 即拒收.裸數字(如 `'30'`)k6 視為毫秒.
- **假瀏覽器測 capture 之事件處理**:以 `EventEmitter` 當 `page`(`emit('requestfinished', 假 req)`),經 `launchBrowser` 注入,即可確定性地測階段歸屬、事件錯誤、排空、`fpBase` 等競態,免真瀏覽器;還原修正後測試會轉紅(已做變異驗證).
- 工具輸出的反斜線:以 shell heredoc 寫入含 `\\` 的程式碼時反斜線可能被折半(曾使測試字串少一個 `\`);含跳脫字元的程式碼一律用 Write/Edit 工具,寫後 Grep 回驗.

## 外部執行檔(k6;2026-10-29 改造,規格見 `C:\opensrcOper\dspec\外部執行檔之存放下載校驗與離線.md`)

- **主幹模式的每次呼叫都會先取一次主幹清單**:不論快取是否命中,連網模式(未離線)`fsEnsureBins` 先請求 `raw.githubusercontent.com/yuda-lyu/w-scan-stress/master/bin/manifest.json`(上限 1MB,逾時 `stallMs` 30 秒);推 GitHub 前主幹尚無該檔(404)時退回包內基準清單.測試中第二次呼叫「不重新下載」的斷言是 zip 請求數不變,而非零請求;零請求要 `offline: true`.
- **測試主幹清單的陷阱**:基準清單與測試伺服器回的主幹清單相同時,改基準清單(如竄改 `extract` 校驗值)不會生效——主幹清單會取代它.要測基準清單的行為,伺服器須回 500/無效(`trunk: '500'`),否則測的是主幹清單(曾因此誤判為「extract 不符仍成功」).
- **k6 真檔不在 repo,下載路徑以「與真清單同形之合成清單」測**:取真清單,只把 zip、解出檔的 sha256/大小換成合成 zip(`tar.exe -a -cf`)內容的值;網址、成員路徑(`k6-<tag>-windows-amd64/k6.exe`)沿用.假套件根(`test/_tmp/…/root/src/ensureBins.mjs` 副本＋合成 `bin/manifest.json`)使 `pkgRoot` 落在暫存夾.主函數接線測試複製整個 `src/` 到假套件根.
- **攔截 `child_process`**:`createRequire(import.meta.url)('node:child_process')` 取得 CJS 物件,改寫其 `spawn`/`spawnSync` 後呼叫 `syncBuiltinESMExports()`,已 `import { spawn } from 'node:child_process'` 之模組即看到新函數;只對 `k6.exe` 回假結果,其餘(如 wsemi 的 tar 解壓)照常呼叫原函數;`after` 必須還原並再同步.
- **`genBinManifest` 取 zip 之核對**:sha256 取自廠商 `k6-<tag>-checksums.txt`,大小取自 GitHub API 之資產 `size`,API 另附 `digest`(`sha256:…`)時須一致;三者交 `fsDownloadFileVerify` 下載校驗;解出的 `k6.exe` 先 `tar -tf` 列成員(須恰有一個檔名為 `k6.exe`)再 `tar -xf -- <成員>`.k6 v2.3.0 的 zip 成員為 `k6-v2.3.0-windows-amd64/k6.exe`(解出 67116752 位元組).
- **UMD 打包驗證不可覆寫 `dist/`**:`toolg/gDistRollup.mjs` 輸出固定 `./dist`;驗證時於 `tmp/` 放一份以 `fdTar` 改指 `./tmp/…` 的副本執行,並以 `require` 該檔檢查預設匯出與 `.ensureBins`.

## Windows 行為

- `child_process.spawn` 對「存在但非可執行檔」(如文字檔命名為 `k6.exe`)**同步拋錯** `spawn UNKNOWN`,不走 `error` 事件;對不存在的檔則走 `error` 事件(ENOENT).`runK6` 兩者皆處理.`spawnSync` 則回傳 `error`.
- `netstat -ano` 於施壓時輸出可達數 MB(大量連線與 TIME_WAIT),`execSync` 預設 `maxBuffer` 1MB 會 ENOBUFS,若被 `catch` 吞掉就變成「資源欄位全是 -」.已放大 `maxBuffer` 並讓 stderr 不外洩(2026-10-30 起 netstat 改由 wsemi 的 `execProcessPortPidsSync` 執行,其自設 `maxBuffer` 64MB、逾量視為失敗;本套件之 `EXEC_OPT` 只剩 `tasklist` 用).
- `where k6.exe` 的錯誤訊息為系統語系(Big5)編碼,只看離開碼,不要解讀其文字.
- **本機 OS(Windows 11 26300＋KB5127936)上 netstat 不可信**(2026-10-30,主控經驗第三十七節;本套件實測):本程序在 `127.0.0.1`、`0.0.0.0`、`::` 各監聽 5 次,`netstat -ano` 列出 0/15,舊 `pidOfPort`(只認 `LISTENING` 列)查得 0/15 而回 `''`,於是 `procPorts` 之資源欄全為 `-`(誤判無人監聽,且與「查詢失敗」同形).對外連線反列 `LISTENING`、狀態值亂(`FIN_WAIT_1`/`CLOSED`)亦見.已改經 wsemi 1.9.32 之 `execProcessPortPidsSync`(不依狀態欄;netstat 查無再以 `Get-NetTCPConnection` 確認),見 R15.代價:新起之監聽與無人之埠每次約 0.8~1.2 秒(PowerShell 冷啟動),`snapProcs` 每級施壓前後各一次.不要再在本套件自行解析 netstat.
- **查詢結果三態不可併成空值**:無人監聽(`[]`/`null`)、查詢失敗(`{ error }`)、tasklist 取不到(`null`)在 `sys.json` 與報告須可分辨;`report.mjs` 遇 `{ error }` 時 `pid` 皆為 `undefined`,`a.pid !== b.pid` 判不出差異,若不另判 `error` 會算出 `NaN%`(`cpuOf` 已加守衛並有測試).
- **做「真實的查詢失敗」之槓桿是 `process.env.SystemRoot`**:wsemi 以入口時之 `%SystemRoot%` 組 `netstat.exe`、`powershell.exe` 路徑,指向不存在的夾即兩者皆 ENOENT(`withEnv({ SystemRoot: 'Z:\\…' }, …)`,測完還原).實測 k6 在此環境變數下仍能啟動並完成 smoke,故可在 `unit-WScanStress` 以此驗證呼叫鏈(日誌、`sys.json`、報告)而不必為測試在主函數開注入口;`console.log` 暫時攔截後須在 `finally` 還原.

## 工具與編輯

- Edit 工具會裁掉 `new_string` 結尾的空白:若 `old_string` 以空白結尾(如 `const ms = `),替換後會缺空格而被 eslint `space-infix-ops` 抓到.改寫時把結尾空白一併涵蓋進後續的字元,並以 eslint 回驗.
- 參考套件自身 eslint 並非 0 error(w-scan-vulnerability 6、w-scan-dep 30),本套件以 `src test g.mjs --ext .mjs` 為 0 error 為準;`toolg/gDistRollup.mjs` 之未使用 `getFiles` 沿用範本,不在範圍.
- `dist`(UMD)內 `import.meta.url` 經 rollup 轉為以 `__filename` 為基準,故 `locateK6Script` 在 dist 內找到的是 `../src/k6Scenario.js`;改變發布內容(例如排除 `src/`)前須先處理此依賴.
