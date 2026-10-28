# 規則帳本

本檔為套件設計與開發階段之規則帳本,為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.

以[規則]為單位(而非以缺陷站點為單位).每條附:規則內容、盤點指令(可重跑)、站點全集與判準(已套/未套/刻意不套)、對應測試.盤點指令皆於套件根目錄執行.

## 0. 套件定位與單一擁有者

- 本套件為基於 k6 且可注入情境(scenario)與工作階段(session)之壓力測試工具,僅支援 Windows.作法比照 `w-scan-dep`、`w-scan-vulnerability`(單一主函數,子模組分工,JSDoc 與 README 寫法一致).
- 單一擁有者:

| 事項 | 唯一擁有者 | 他處只引用不重寫 |
| --- | --- | --- |
| 對外主函數 | `src/WScanStress.mjs` 之 `WScanStress(fdOut, opt)`(預設匯出) | README `Options`、`g.mjs`、jsdoc `@example` 皆自此衍生 |
| k6 之取得(下載、校驗、快取、鏡像、離線) | `src/ensureBins.mjs`(轉呼叫 wsemi `fsEnsureBins`)與 `bin/manifest.json`(由 `toolg/genBinManifest.mjs` 產生),見 R14 | README〈外部執行檔〉;`WScanStress.ensureBins` 為其靜態屬性 |
| k6 之執行、安全閘判定 | `src/k6.mjs` 之 `runK6`、`gateTriggered`、`locateK6Script` | — |
| 情境格式 | `src/k6Scenario.js` 檔頭說明(k6 讀取端)與 `src/scenario.mjs` 之 `validateScenario`(檢核端) | README〈情境〉 |
| 預設參數、安全閘 | `src/config.mjs` 之 `DEFAULTS`、`GATE` | README `Options`、`k6Scenario.js` 之環境變數預設值 |
| 資源記錄 | `src/procStat.mjs` | — |
| 文字報告、對照 | `src/report.mjs`、`src/compare.mjs` | — |
| 瀏覽器擷取 | `src/capture.mjs`(經 `w-scan-stress/src/capture.mjs` 引用,不在 `dist` 內) | — |

- 已知限制:①僅 Windows(k6 之 Windows 版、`netstat`/`tasklist`/`tar.exe`).②主函數捕捉不到 Ctrl+C/行程被終止:此時 `finally` 不執行,session 未釋放且結果資料夾內 `.manifest.json`(含 session 之值)留存,須使用方自行處理(README〈Notes〉).③`capture.mjs` 需 `playwright` 與其瀏覽器,`dist`(`main`)不含之.④k6 取得走清單之版本標籤資產網址(不查 GitHub API),主幹模式連網時每次呼叫先取一次 `raw.githubusercontent.com` 之主幹清單(2026-10-29 起,見 R14).

## 1. 規則(程式碼須長成什麼樣)

### R01 公開入口與模組分工

- 內容:`src/WScanStress.mjs` 只有一個預設匯出之 async 函數;k6 執行/安全閘、情境、資源記錄、報告、對照、擷取各在子模組(k6 之取得在 `ensureBins.mjs`,為預設匯出之薄轉呼叫,亦作為 `WScanStress.ensureBins` 靜態屬性);主檔只做參數檢核與流程編排.子模組之函數可具名匯出供單元測試,但不經主檔再匯出.
- 盤點:`grep -n "^export" src/*.mjs`;`grep -c "^export default" src/WScanStress.mjs`
- 站點全集與判準:`WScanStress.mjs` 僅 `export default`(已套;`ensureBins` 以靜態屬性掛上,不加具名匯出,否則 rollup UMD 改輸出 `exports.default`,破壞 `require('w-scan-stress')`);其餘模組僅具名匯出,`capture.mjs`、`ensureBins.mjs` 另有預設匯出(刻意:README 以 `import capture from 'w-scan-stress/src/capture.mjs'`、`import ensureBins from 'w-scan-stress/src/ensureBins.mjs'` 引用).
- 對應:`test/unit-WScanStress.test.mjs`、各 `unit-*.test.mjs` 以模組為單位.

### R02 JSDoc 風格(同 w-scan-dep、w-scan-vulnerability)

- 內容:①檔頭 `//` 註解說明本檔職責.②每個函數(含模組私有、具名匯出者)有 `/** */`,繁體中文,首行一句話,必要時空行後補充;`@param {型別} 名稱 輸入…`、`@returns {型別} 回傳…`,非同步為 `@returns {Promise} 回傳Promise，resolve回傳…，reject回傳錯誤訊息`.③主函數 `@class` 並附 `@example`,內容與 `g.mjs`、README 範例一致.④`src/` 不得有 BigInt 字面值(jsdoc 會當掉).⑤箭頭函數之極短輔助(`ms`、`pad` 等單行)可不加.
- 盤點:`grep -nE "^(export )?(async )?function |^(export )?const [A-Za-z]+ = (async )?\(" src/*.mjs`(逐一對照其前有 `*/`);`grep -nE "\b[0-9]+n\b" src/*.mjs src/*.js`(須無輸出).
- 判準:函式型站點皆有 jsdoc 為已套(`WScanStress.mjs` 之 `releaseAll` 與 `WScanStress`、`k6.mjs`/`config.mjs`/`procStat.mjs`/`scenario.mjs` 之匯出函數、`ensureBins.mjs` 之 `ensureBins`、`capture.mjs`、`report.mjs`、`compare.mjs` 之匯出函數);單行 `const xx = (...) =>` 輔助為刻意不套(`report.mjs`/`compare.mjs` 之 `ms`、`pad`、`padL`、`pct`、`g`、`cpuTxt`、`memTxt`、`sysCpuTxt`、`uniq`,`scenario.mjs` 之 `isObj`、`isNum`).2026-10-18 盤點:無 BigInt 字面值.
- 對應指令:`node_modules/.bin/jsdoc -c <以 .jsdoc 為底、destination 改至 ./tmp/ 之設定>` 須 exit 0.

### R03 參數檢核:先檢核再取資源,錯誤訊息指出欄位

- 內容:`WScanStress` 於取得 k6(`ensureBins`)、取 session、建立結果資料夾之前,先檢核全部 `opt`(取得 k6 失敗,如 `E_OFFLINE_MISSING`,亦在取 session 之前):須給情境;固定之情境檢格式;`levels` 為正整數之非空陣列且不得重複(各級以人數命名輸出夾);`ramp`/`dur`/`gate.timeout` 為 k6 時間格式(須帶單位;空字串不當未給,故用 `??` 而非 `||`);`gap` 為非負數;`batchPerHost` 為正整數(空字串、`0` 不當未給);`gate` 之門檻為非負數;`procPorts` 之值為 1~65535 整數;`getSessions`/`releaseSessions`/`buildScenario` 給了則須為函數;`label` 不含路徑分隔與 Windows 檔名禁用字元且 ≤ 100 字元;`fpPending` 給了則須為字串;指定之 `k6Path` 存在且可執行 `version`.訊息為繁體中文並含欄位名(`opt.xxx`).
- 盤點:`grep -n "throw new Error" src/WScanStress.mjs`;`grep -ohE "opt\.[A-Za-z0-9_]+" src/WScanStress.mjs | sort -u`(每個 `opt.*` 鍵須有檢核或預設值,見下表).
- 站點全集(opt 鍵 → 檢核/預設):`buildScenario`/`scenario`(須擇一;scenario 先 validate)、`getSessions`(函數;預設 `[{}]`)、`releaseSessions`(函數)、`fpPending`(字串;預設結果資料夾內)、`mode`('smoke' 或預設 'level',其他值視為 level,刻意)、`levels`、`ramp`、`dur`、`gap`、`batchPerHost`、`gate`(物件覆寫 `GATE`;各值檢核)、`label`、`k6Path`、`offline`(`=== true` 才傳 `ensureBins`)、`procPorts`、`labels`(物件)、`meta`(物件或函數)、`quiet`(`=== true`).2026-10-29 起無 `fdTools`(見 §3 第 2 次).
- 對應:`test/unit-WScanStress.test.mjs` 之〈參數檢查〉.

### R04 session 之生命週期:取得即釋放,釋放失敗不遮蓋原錯誤、不遺失 session

- 內容:①結果資料夾於取 session **之前**以非遞迴 `mkdir` 原子保留(同標籤加序號;並行呼叫不共用);`getSessions` 失敗(拋錯、空、元素非物件)時移除該空夾.`getSessions` 回傳後,其後任何失敗(情境產生/格式、meta、k6 執行)皆經 `finally` 呼叫 `releaseSessions`(`try` 之前只有 `collectSecrets` 純運算);報告產製在 `finally` 之後,不影響釋放.②`releaseSessions` **須回傳陣列**;拋錯或回傳非陣列(含 `undefined`、`false`、`0`、`''`)時,視為全部未能釋放(`pending` = 全部 session),記錄訊息(其中 session 之值已遮蔽),仍存檔,**不**遮蓋 try 區塊之原始錯誤.③`finally` 內各項(刪清單檔、釋放、存 pending、更新 meta)各自 `try/catch`,互不阻斷;存 pending 依序嘗試 `opt.fpPending`、結果資料夾內 `sessions_pending.json`.④`.manifest.json`(含 session 之值)於 `finally` 第一步即刪.⑤`meta.json` 以 `maskDeep` 先遮蔽再序列化(不可對序列化後之字串替換);`k6.log` 於每級 `runK6` 之 `finally`(成功與 reject 皆執行)以 `maskFile` 遮蔽;`report.txt` 由已遮蔽之 `k6.log` 衍生.⑥`fpPending` 之內容含 session 之值,README 提醒置於不入版控處;`.gitignore` 含 `sessions_pending*.json`、`.manifest.json` 為最後防線.⑦流程被強制終止(Ctrl+C)時 `finally` 不執行,為已知限制(見 §0).
- 盤點:`grep -n "releaseSessions\|\.manifest\|maskSecrets\|fpPending" src/WScanStress.mjs`;`git check-ignore -v sessions_pending.json .manifest.json`
- 對應:`test/unit-WScanStress.test.mjs` 〈實跑〉之各案(釋放、遮蔽、pending、releaseSessions 拋錯).

### R05 子行程與同步指令:失敗要收尾、輸出要夠大

- 內容:①每個 `spawn` 須掛 `error` 事件,spawn 失敗(ENOENT/EACCES/EPERM,Windows 對非執行檔為同步拋 `spawn UNKNOWN`)時關閉寫入串流並 reject 帶明確訊息,不得成為未捕捉例外;`k6.log` 之寫入串流 `error` 須**先於 spawn** 掛上,`end` 回呼帶出之錯誤亦 reject(不得誤 resolve).②呼叫端以 `try/finally` 停止取樣器(`startSampler` 之計時器不得留著).③`execSync`/`spawnSync` 取輸出者須明設 `maxBuffer`(施壓時 `netstat -ano` 可達數 MB,預設 1MB 會 ENOBUFS 而靜默得到空結果),stderr 不外洩至主控台.④`taskkill`/終止行程不在本套件範圍(k6 隨 stdio 結束,Ctrl+C 時同主控台一併中止).
- 盤點:`grep -nE "\b(spawn|spawnSync|execSync)\(" src/*.mjs`
- 站點全集與判準:`src/k6.mjs` 之 `runK6`(已套 ①)、`k6Version`(spawnSync,已檢 `error`/`status`);`src/procStat.mjs` 之 `pidOfPort`、`procStat`(execSync,已套 ③);取樣器停止見 `WScanStress` 之 `finally`(已套 ②).
- 對應:`test/unit-k6.test.mjs`、`test/unit-procStat.test.mjs`、`test/unit-WScanStress.test.mjs`.

### R06 情境格式:檢核端須涵蓋 k6 腳本讀取之每個欄位

- 內容:`src/k6Scenario.js` 讀取之欄位,`validateScenario` 須事先檢核,否則錯誤只在施壓開始後於 k6 內以執行期例外出現(迭代中止、無明確訊息).欄位表(讀取端 → 檢核端):

| 欄位 | k6Scenario.js 讀取處 | validateScenario 檢核 |
| --- | --- | --- |
| `bodies[k]` | `b64decode(…, 'std')` | 合法之標準 base64 字串(含補齊 `=`,空字串可) |
| `bodiesPerVu[k]` | `.map(b64decode)` | 非空陣列,各項同上 |
| `phases[].kind` | 分支 | `requests`/`stay`/`sleep` |
| `phases[].name` | `group(name)` | 給了則須為字串 |
| `requests.steps` | `st.forEach`/`runBatch` | 非空陣列,每步為請求陣列 |
| `requests.timer` | `new Trend(timer)`、`new Rate(timer_ok)`、物件鍵 | 識別字;不得為 k6 內建/本套件指標名或 `__proto__`,不得以 `_ok` 結尾 |
| `stay.sec`/`ticks[].every`/`ticks[].reqs` | 逐秒迴圈 `t <= sec`、`t % every`、`reqs.push(...)` | 正整數/正整數/陣列(小數之 sec 會被截斷、小數之 every 無法整除) |
| `sleep.sec` | `sleep()` | 非負數 |
| `req.name` | 標籤、門檻、物件鍵 | 英數字、底線、點、冒號、連字號;不得為 `__proto__` |
| `req.url` | `fill(url)` | 非空字串 |
| `req.method` | `r.method \|\| 'GET'` | 英文字母開頭、僅含英數字/底線/連字號之字串(HTTP 方法為 token,如 `M-SEARCH`) |
| `req.headers` | `for in` | 物件 |
| `req.body.ref`/`refPerVu`/`text` | 取本體 | 自有鍵存在於 bodies/bodiesPerVu(`Object.hasOwn`,繼承自原型者如 `toString` 不算);text 為字串 |
| `req.check.status` | `sts.includes` | 非空整數陣列 |
| `req.check.header` | `.name`/`.equals` | 物件,`name` 為非空字串,`equals` 為字串 |
| `req.check.json` | `.every(q => q.path/equals)` | 陣列,各項 `path` 為非空字串,`equals` 為字串/有限數字/布林/`null`(缺少時 `undefined === undefined` 使缺欄位反而通過檢核) |
| 所有陣列(phases、steps、ticks、reqs、status、json、bodiesPerVu、levels、sessions) | `forEach`/`every`/`map` 會跳過稀疏陣列之空位 | 以 `Array.from` 逐索引檢核,空位視為未給(序列化後空位會變成 `null`) |

- 盤點:`grep -nE "\b(r|ph|st|tk|c|q)\.[a-zA-Z]+" src/k6Scenario.js | grep -oE "\b(r|ph|st|tk|c|q)\.[a-zA-Z]+" | sort -u`(每一欄位須在上表).
- 對應:`test/unit-scenario.test.mjs`.

### R07 路徑與出檔位置

- 內容:輸出一律在呼叫端指定之 `fdOut`/`fpPending`(場景 A,用 `resolve`);以 `import.meta.url` 取檔案位置者為 `locateK6Script`(場景 B:自帶之 `k6Scenario.js`,src 內同層、`dist` 內為 `../src`)與 `ensureBins.mjs` 之 `pkgRoot`(套件根,`src/`、`dist/` 皆在其下一層,與工作目錄無關;k6 快取預設 `<套件根>/bin-cache/`),使用 `fileURLToPath`;不用 `new URL(import.meta.url).pathname`.測試之臨時檔在 `test/_tmp/<案名>/`,測完即刪.
- 盤點:`grep -n "import.meta" src/*.mjs`;`grep -n "\.pathname" src/*.mjs`(只許 `capture.mjs`/測試中對網址物件之 `url.pathname`,不得用於檔案路徑).

### R08 測試目標只能是本機自建之服務

- 內容:壓力測試之流量只送往測試自建之 `127.0.0.1` 服務(`test/tools/demoServer.mjs`);測試、範例、README 中的網址只許為 `127.0.0.1`/`localhost`/`example.invalid`/`api.github.com`、`github.com`、`raw.githubusercontent.com`(僅作為 k6 取得與清單產生之「原網址」,測試以注入之 `fetch` 改指本機伺服器,斷言網址形式,不連外網;全域 `fetch` 於主函數入口測試中攔截禁用)及文件連結.
- 盤點:`grep -nE "https?://" g.mjs test/*.mjs test/tools/*.mjs README.md | grep -vE "127\.0\.0\.1|localhost|example\.invalid|api\.github\.com|shields\.io|npmjs\.org|github\.com|raw\.githubusercontent\.com|jsdelivr|github\.io|http://a"`(僅允許 `test/tools/demoServer.mjs:55` 一行:以請求標頭組成之樣板字串供解析路徑,非固定網址;`evil.invalid` 一行為不轉傳 `floatingManifestUrl` 之探針網址).
- 埠(≥ 8000,不隨機,各檔唯一):`g.mjs` 8090、`unit-WScanStress` 8091、`unit-capture` 8092、`unit-procStat` 8093、`api-ensureBins` 8094、`unit-genBinManifest` 8095;新增測試服務依序取 8096 起.盤點:`grep -nE "port: ?[0-9]+|PORT = [0-9]+" g.mjs test/*.mjs`.

### R09 測試規範(本套件對 role-coder-for-test 之落實)

- 內容:①檔名 `unit-*.test.mjs`(純函式、注入之 `fetch`、本機示範服務、真 k6/真瀏覽器之整合亦屬此層)與 `api-*.test.mjs`(`api-ensureBins`:`ensureBins` 之取得、鏡像、快取、離線與主函數之接線;本機 HTTP 伺服器與真實資料夾,不另開子目錄);輔助工具在 `test/tools/`(無 `.test.`).②每條 assertion 上方有 `//規則:` 註解對應本帳本/README/jsdoc 之一句.③`package.json` 之 scripts 僅 `test`(與 `deploy`)、mocha 指令為 `mocha --parallel "test/*.test.mjs" --timeout 180000`;不用 `.mocharc.json`.④測試不寫 `./tmp/`.⑤實跑所需之 k6(測試不連網):環境變數 `K6_PATH` → `PATH` 內之 `k6.exe` → 清單所載之 k6 已在快取(`bin-cache/` 或 `W_BIN_CACHE`)或 `W_BIN_MIRROR` 鏡像者(`test/tools/findK6.mjs`,經 `ensureBins` 離線取得並校驗);皆無則實跑各案略過(印出提示,不假綠也不下載).新複製之 repo 須於可連網環境執行一次 `src/ensureBins.mjs` 暖快取.
- 盤點:`ls test`;`grep -n "\./tmp" test/*.mjs test/tools/*.mjs`(須無輸出);`ls .mocharc* 2>/dev/null`(須無).

### R10 風格與 Lint

- 內容:4 空白縮排、單引號、無分號、`brace-style` 為 stroustrup(`try`/`catch` 不可單行)、物件屬性若跨行則一行一個(`object-property-newline`)、Promise 建構子參數命名為 `resolve`/`reject`.
- 盤點:`node_modules/.bin/eslint src test g.mjs --ext .mjs`(0 error);`node_modules/.bin/eslint src/k6Scenario.js`(0 error).`toolg/gDistRollup.mjs` 之未使用 `getFiles` 沿用參考套件範本,不在 lint 範圍.

### R11 打包

- 內容:`toolg/gDistRollup.mjs` 之 `fns` 為 `WScanStress.mjs`;`globals` 與 `external` 須涵蓋主檔可達模組之全部內建模組:`node:path`、`node:url`、`node:os`、`node:fs`、`node:fs/promises`、`node:child_process`(本套件 src),以及 wsemi `fsEnsureBins` 使用之未加前綴者:`path`、`url`、`os`、`fs`、`child_process`、`crypto`、`stream`、`stream/promises`(外部執行檔規格 §9;wsemi 被打包進 UMD,內建模組須外部化);`playwright` 只被 `capture.mjs` 使用,該檔不在主檔可達範圍,故不列入.`dist` 可由發布流程重產,`docs` 不手動產.
- 盤點:`grep -hE "^import .* from '" src/WScanStress.mjs src/ensureBins.mjs src/config.mjs src/scenario.mjs src/k6.mjs src/procStat.mjs src/report.mjs | sed -E "s/.*from //" | sort -u` 與 `grep -hE "^import .* from '[a-z/]+'" node_modules/wsemi/src/fsEnsureBins.mjs`(與 gDistRollup 之 `external` 比對);打包驗證須另指定輸出夾至 `./tmp/`(見經驗),不覆寫 `dist/`:`require` 該 UMD 須得函數且 `.ensureBins` 為函數.

### R13 報告與對照:缺值、損毀與邊界

- 內容:①某級 `summary.json` 不存在或損毀時,`loadLevel` 回傳 `null`(不拋 SyntaxError),`buildReport` 仍列出該級並指向其 `k6.log`,不得把失敗的最後一級隱去;`sys.json` 損毀視為無資源記錄.②級距依人數數值排序(非字串序).③門檻值 `0` 為有效值,以型別判斷而非 truthy;「超過」門檻才標 ✗(恰等於不標),與 k6 腳本之 `<=` 門檻一致.④數值欄位無值時以 `0` 列(`|| 0`),不得印出 `null`/`undefined`/`Infinity`/`NaN`;`cpuOf` 於秒數非正時回 `null`.⑤`buildCompare` 遇彙總內無 `metrics` 拋明確錯誤;門檻段只在兩方皆有門檻結果且 ✓/✗ 改變時判改善或退步(缺值為無法對照).⑥`failStat` 之逐秒分佈取最近一次進度行之測試時間,屬約略值,報告已註明.
- 盤點:`grep -n "|| 0\|?? " src/report.mjs`;`node node_modules/mocha/bin/mocha.js --no-parallel test/unit-report.test.mjs test/unit-compare.test.mjs`.
- 對應:`unit-report.test.mjs`(〈無請求或無結果〉〈級距不完整、損毀與排序〉)、`unit-compare.test.mjs`.

### R12 文件與程式同步

- 內容:①主函數與 `normOpt` 讀取之每個 `opt.<鍵>`,皆在 README〈Options〉表(以 `` `鍵` `` 列出)與主函數 jsdoc 之 `@param` 出現.②README 之範例、主函數 jsdoc 之 `@example` 與 `g.mjs` 為同一份程式(以 `g.mjs` 為源,僅 import 行不同);改範例時三處同步改.③`docs/` 由發布流程產製,不手動產.
- 盤點:`grep -ohE "opt\.[A-Za-z0-9_]+" src/WScanStress.mjs src/config.mjs | sort -u`(含註解中者,測試只取程式碼行);`node node_modules/mocha/bin/mocha.js --no-parallel test/unit-docs.test.mjs`.
- 站點全集:`opt` 鍵共 19 個(buildScenario、scenario、getSessions、releaseSessions、fpPending、mode、levels、ramp、dur、gap、batchPerHost、gate、label、k6Path、offline、procPorts、labels、meta、quiet),以測試擷取為準.

### R14 外部執行檔(k6.exe)之存放、下載、校驗與離線(摘要;制式規格全文見 `C:\opensrcOper\dspec\外部執行檔之存放下載校驗與離線.md`)

- 本套件為 **C 類、主幹模式**(登記於主控帳本 G10:壓測工具須保持新版,使用者 2026-10-28 選):唯一之外部執行檔為廠商檔 `k6.exe`(grafana/k6 Windows zip 內),**不鏡像入 repo**(S3).清單 `bin/manifest.json`(`mode: "floating"`,`manifestPath` 預設)記 k6 版本標籤之資產網址(`https://github.com/grafana/k6/releases/download/<tag>/k6-<tag>-windows-amd64.zip`,不得 `releases/latest`)、zip 與解出之 `k6.exe` 各一組 sha256/大小,`note` 載明核對依據(M2、M3).
- 套件端只做三件事(E2):①清單由 `toolg/genBinManifest.mjs` 產生(不手寫;查 k6 最新版 → 下載 zip 與 `k6-<tag>-checksums.txt` → 核對 checksums、API digest、大小 → 解出 `k6.exe` 自算 → 產清單 → 以 `fsEnsureBins` 做 schema 檢核;`--tag`、`--dry`);②`src/ensureBins.mjs` 轉呼叫 wsemi `fsEnsureBins('bin/manifest.json', { ...opt, pkgRoot })`(不轉傳 `floatingManifestUrl`);③`WScanStress` 未給 `k6Path` 時以 `ensureBins({ names: 'k6.exe' })` 取得路徑後才 `k6Version`/`runK6`(且在取 session 之前),並以靜態屬性 `WScanStress.ensureBins` 匯出.不得另寫下載、快取、校驗、解壓.
- 存放(S1、S5):`.npmignore` 列 `/bin/*`、`!/bin/manifest.json`、`/bin-cache/`、`/test/_tmp/`;`.gitignore` 列 `/bin-cache/`;`.gitattributes` 設 `bin/** binary`;無 `postinstall`(D1).UMD 打包之 external/globals 見 R11.
- 取得順序(O2):快取(`<套件根>/bin-cache/<sha256>/k6.exe`,或 `W_BIN_CACHE`/`ensureBins({ cacheDir })`,命中亦校驗)→ 鏡像(`W_BIN_MIRROR`,`<鏡像>/w-scan-stress/<sha256>/<name>`)→ 清單之版本標籤網址;主幹模式連網時先取 GitHub 主幹清單,取不到/不合格式時用包內基準清單(M5);離線(`W_BIN_OFFLINE=1` 或 `opt.offline`)缺檔為 `E_OFFLINE_MISSING`(訊息含檔名、sha256、大小、應放路徑).
- 盤點:`node C:/opensrcOper/tools/scan-bins.mjs --only w-scan-stress`(應為 OK);`npm pack --dry-run --json`(無 exe/zip,`bin/` 下只有 `manifest.json`);`grep -nE "fetch\(|api\.github|releases/latest|tar\.exe|fsDownloadFile[^V]" src/*.mjs`(程式碼行須無輸出).
- 對應測試:`unit-binManifest.test.mjs`(S1/S5/T1 含誘餌檔、T2 改驗網址形式、M1~M3、D1、E4、R11、README 〈外部執行檔〉)、`api-ensureBins.test.mjs`(T3~T8、E2 不轉傳、D3 與 cwd 無關、環境變數、主函數接線:攔截全域 `fetch` 與 `child_process.spawn`/`spawnSync`,斷言啟動者為 `ensureBins` 回傳之路徑)、`unit-genBinManifest.test.mjs`(更新工具,本機伺服器)、`unit-WScanStress.test.mjs`(真 k6 經鏡像取得並實跑)、`unit-docs.test.mjs`.
- k6 之真檔(zip 約 30MB)不入 repo,故下載路徑(T3、T4、T8)以「與真清單同形之合成清單」驗證(沿用真清單之網址、鍵名、成員路徑,僅校驗值換成合成內容之值,套件根為暫存夾內之副本),真清單本身由 T6(經 `src/ensureBins.mjs` 離線缺檔,訊息含真清單之值)與 schema 檢核案驗證;真 k6 之取得與實跑僅在快取已暖時執行.
- 更新 k6(U2、U3):`node toolg/genBinManifest.mjs`(`--dry` 乾跑)→ `npm test` → 與程式一併推 GitHub 主幹即生效;包內基準清單於下次發布時隨包更新.

## 2. 規則 → 測試對照

| 規則 | 測試檔 | 案例 |
| --- | --- | --- |
| R01 | `unit-*.test.mjs` | 各模組之匯出被各檔直接引用 |
| R03 | `unit-WScanStress.test.mjs`、`unit-config.test.mjs` | 〈參數檢查〉各案(接線:不取 session、不建資料夾);`normOpt` 之直接案例 |
| R12 | `unit-docs.test.mjs` | opt 鍵與文件;範例三處一致 |
| R04 | `unit-WScanStress.test.mjs`、`unit-scenario.test.mjs` | 〈實跑〉:smoke 之釋放與遮蔽、逐級之 pending、釋放拋錯、非陣列、情境產生失敗仍釋放、並行呼叫各自獨立、k6.log 遮蔽、getSessions 失敗移除空夾、fdOut 為檔案;`releaseAll`/`maskDeep`/`maskFile` 之直接案例 |
| R05 | `unit-k6.test.mjs`、`unit-procStat.test.mjs` | spawn 失敗 reject(含日誌不可寫);`gateTriggered`;`pidOfPort`/`procStat`/取樣器 |
| R06 | `unit-scenario.test.mjs` | `validateScenario` 各案(型別、equals、稀疏陣列、原型名稱、base64) |
| R13 | `unit-report.test.mjs`、`unit-compare.test.mjs` | fixtures 在 `test/fixtures/run`(唯讀,有雜湊快照);級距不完整/損毀/排序/零門檻/邊界 |
| 擷取 | `unit-capture.test.mjs` | 實擷需 playwright 之 chromium;事件處理用假瀏覽器(階段歸屬、事件錯誤、排空、fpBase) |
| R14 | `unit-binManifest.test.mjs`、`api-ensureBins.test.mjs`、`unit-genBinManifest.test.mjs`、`unit-WScanStress.test.mjs` | 清單與打包(T1/T2)、取得(T3~T8)、主函數接線、更新工具、真 k6 經鏡像實跑 |

## 3. 破壞性變更紀錄

- 第 1 次對齊(2026-10-18,版本維持 1.0.0,尚未發布;對外語意之變動皆因尚未發布而直接改,列於待裁示供確認):
  ①`releaseSessions` 拋錯不再使主函數拋出該錯誤,改視為全部未能釋放並回傳於 `pending`;**回傳非陣列(含未回傳值、`false`、`0`、`''`)亦視為全部未能釋放**(原 falsy 視為全部釋放).
  ②`opt` 之檢核更嚴(格式不符者原本在 k6 內才失敗,現於施壓前拋錯);`levels` 不得重複;`ramp`/`dur` 空字串不再取預設;`gap`/`batchPerHost` 空字串不再當 0;`label` ≤ 100 字元;`fpPending` 須為字串.
  ③`runK6` 等移至 `src/k6.mjs`、`releaseAll`/`maskDeep`/`maskFile` 置於 `src/scenario.mjs`(非對外 API).
  ④情境檢核更嚴:`stay.sec`、`ticks[].every` 須為正整數;`check.header.equals`、`check.json[].equals` 必須給;`method` 允許連字號;`bodies` 須為合法標準 base64;稀疏陣列之空位視為未給;`__proto__` 不得為名稱.
  ⑤安全閘門檻改為 `<=` 上限(原 `<`):上限 `0` 變為可用(零容忍),恰等於上限不再算超過;該級彙總缺任一項安全閘指標視為無結果.
  ⑥結果資料夾改為取 session 之前原子保留(原為取 session 之後才建立,且先檢查後建立);`getSessions` 失敗時移除空夾.
  ⑦`capture` 回傳與結果檔新增 `failedSteps`;`buildReport` 對損毀/缺失之級距列出而不拋錯.
- 第 2 次(2026-10-29,外部執行檔制式規格改造,原則 14:不留相容層,下游連帶修正;版本未動):
  ①k6 改經 `ensureBins`(wsemi `fsEnsureBins`)依 `bin/manifest.json` 取得並校驗;移除 `src/download.mjs`(`ensureTool`/`ensureAllTools`/`findLatestCached`/`installVerDir`/`cmpVerDesc`)與 `config.mjs` 之 `TOOLS`、`test/unit-download.test.mjs`.
  ②移除選項 `fdTools`(k6 存放資料夾);快取改 `<套件根>/bin-cache/<sha256>/k6.exe`,位置由 `W_BIN_CACHE`/`ensureBins({ cacheDir })` 決定;給了 `fdTools` 不報錯但不讀取(有測試);`fdOut/tools/` 不再產生.
  ③`offline: true` 改為「只用快取與 `W_BIN_MIRROR`」,不再「沿用快取中最新版本」(缺清單所載版本之 k6 → `E_OFFLINE_MISSING`).
  ④新增 `WScanStress.ensureBins`、`src/ensureBins.mjs`、環境變數 `W_BIN_CACHE`/`W_BIN_MIRROR`/`W_BIN_OFFLINE`、相依 `wsemi`、`toolg/genBinManifest.mjs`;`npm test` 不再下載 k6(實跑所需之 k6 見 R09 ⑤).
