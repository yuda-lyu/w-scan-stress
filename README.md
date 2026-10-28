# w-scan-stress
A stress tester with injectable scenarios and sessions, based on k6, in nodejs.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-scan-stress.svg?style=flat)](https://npmjs.org/package/w-scan-stress) 
[![license](https://img.shields.io/npm/l/w-scan-stress.svg?style=flat)](https://npmjs.org/package/w-scan-stress) 
[![npm download](https://img.shields.io/npm/dt/w-scan-stress.svg)](https://npmjs.org/package/w-scan-stress) 
[![npm download](https://img.shields.io/npm/dm/w-scan-stress.svg)](https://npmjs.org/package/w-scan-stress) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-scan-stress.svg)](https://www.jsdelivr.com/package/npm/w-scan-stress)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-scan-stress/WScanStress.html).

## Installation

### Using npm(ES6 module):
```alias
npm i w-scan-stress
```

#### Example
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-scan-stress/blob/master/g.mjs)]
```alias
import wss from 'w-scan-stress'
import startDemoServer from './test/tools/demoServer.mjs' //示範用之服務, 實際使用時換成受測之系統


async function test() {

    let fdOut = './test/output'

    //示範服務: 帳號 demo 密碼 demo-pass 登入取得令牌, 其餘 API 須帶令牌
    let demo = await startDemoServer({ port: 8090 })
    let url = demo.url

    let r = await wss(fdOut, {

        //getSessions, 每位虛擬使用者各自登入, 回傳各自之變數(以 {{token}} 代入請求)
        getSessions: async (n) => {
            let ss = []
            for (let i = 0; i < n; i++) {
                let res = await fetch(`${url}/api/login`, { method: 'POST', body: JSON.stringify({ account: 'demo', password: 'demo-pass' }) })
                let j = await res.json()
                ss.push({ token: j.msg.token })
            }
            return ss
        },

        //releaseSessions, 結束時逐一登出, 回傳未能登出者
        releaseSessions: async (ss) => {
            let pending = []
            for (let s of ss) {
                let res = await fetch(`${url}/api/logout`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}` } }).catch(() => null)
                if (!res || res.status !== 200) pending.push(s)
            }
            return pending
        },

        //buildScenario, 每位虛擬使用者每趟之動線
        buildScenario: () => {
            let auth = { Authorization: 'Bearer {{token}}' }
            let ok = { status: [200], json: [{ path: 'state', equals: 'success' }] }
            return {
                bodies: { q: Buffer.from('示範之二進位本體').toString('base64') },
                phases: [
                    {
                        //進入頁面: 先取登入者, 再並行取清單與查詢, 記錄所需之時間(enter_page)
                        kind: 'requests',
                        name: 'enter',
                        timer: 'enter_page',
                        steps: [
                            [{ name: 'profile', url: `${url}/api/profile`, headers: auth, check: ok }],
                            [
                                { name: 'list', url: `${url}/api/list`, headers: auth, check: ok },
                                { name: 'query', method: 'POST', url: `${url}/api/query`, headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: { ref: 'q' }, check: ok },
                            ],
                        ],
                    },
                    {
                        //停留: 10 秒, 每 2 秒輪詢
                        kind: 'stay',
                        name: 'stay',
                        sec: 10,
                        ticks: [{ every: 2, reqs: [{ name: 'poll', url: `${url}/api/poll`, headers: auth, check: ok }] }],
                    },
                ],
            }
        },

        //procPorts, 記錄資源之行程(依埠找監聽之行程)
        procPorts: { demo: 8090 },

        //labels, 報告中之顯示名稱
        labels: { enter_page: '進入頁面', profile: '取登入者', list: '取清單', query: '查詢', poll: '輪詢', demo: '示範服務' },

        //mode, 'smoke'為1位虛擬使用者走1趟, 先驗證情境與系統一致; 逐級施壓則改給 levels(如 [10, 25, 50])
        mode: 'smoke',

    }).finally(() => demo.close()) //結束(含失敗)皆關閉示範服務
    console.log(r.fdRun)
    // => 'D:\\...\\test\\output\\2026-10-18_1911_smoke'

    // 產出於fdRun:
    //   meta.json 本次參數、情境之摘要與測試機
    //   smoke/(逐級時為各級之vusNNN/) summary.json k6之彙總, sys.json 整機與各行程之資源, k6.log k6之輸出(session之值已遮蔽)
    //   report.txt 文字報告(各級總覽、計時、各分組p95對照與各級明細)
    // k6.exe不在fdOut: 首次使用時經ensureBins取得並校驗，存於套件根之bin-cache/(可由W_BIN_CACHE改位置)

}
test()
    .catch((err) => {
        console.log(err)
    })
```

> 僅支援 Windows：k6 為 Windows 版，各行程之資源以 netstat、tasklist 取得。

#### 設計
本套件不含任何特定系統之請求、登入或編碼，由使用方以依賴注入提供：

| 注入 | 說明 |
| --- | --- |
| `buildScenario` 或 `scenario` | 情境：每位虛擬使用者每趟之請求動線（格式見下） |
| `getSessions`、`releaseSessions` | 為每位虛擬使用者取得登入狀態（如令牌），結束時釋放（如登出） |
| `procPorts`、`labels`、`meta` | 記錄資源之行程、報告之顯示名稱、附加於 meta.json 之使用方資訊 |

本套件負責 k6 之取得、逐級施壓（封閉模型）、安全閘、資源記錄、session 之代入與遮蔽、文字報告。

#### 情境（scenario）
```alias
{
    bodies: { <鍵>: <base64> }, //共用之二進位本體
    bodiesPerVu: { <鍵>: [<base64>, ...] }, //各虛擬使用者各自之二進位本體(第 i 位取第 (i - 1) % 長度 個)
    phases: [ //每位虛擬使用者每趟依序執行
        { kind: 'requests', name, timer, steps: [[req, ...], ...] }, //steps 依序執行, 同一步之請求並行; 給 timer 則記錄本階段所需之時間與是否全部成功(<timer>_ok)
        { kind: 'stay', name, sec, ticks: [{ every, reqs: [req, ...] }] }, //停留 sec 秒(sec、every 為正整數), 第 t 秒發出 t 可被 every 整除之 ticks 之請求; 逐秒執行, 請求耗時亦計入停留時間
        { kind: 'sleep', sec },
    ],
}
```

| 請求（req）之欄位 | 說明 |
| --- | --- |
| `name` | 分組名稱（報告依此分列），英數字、底線、點、冒號或連字號 |
| `method`、`url`、`headers` | 預設 `GET`；網址與標頭之 `{{變數}}` 以該虛擬使用者之 session 代入 |
| `body` | 無、`{ ref }`（`bodies` 之鍵）、`{ refPerVu }`（`bodiesPerVu` 之鍵）或 `{ text }`（文字，可含 `{{變數}}`） |
| `check` | `{ status: [200], header: { name, equals }, json: [{ path, equals }] }`，`equals` 必須給（標頭為字串；JSON 欄位為字串、有限數字、布林或 `null`）；狀態碼不符計入檢核失敗，狀態碼符合而標頭或 JSON 內容不符者另計入 `app_errors`（內容檢核失敗） |

#### Options
| 參數 | 說明 |
| --- | --- |
| `buildScenario` | 產生情境之函數，傳入 `{ sessions, nVus }`，與 `scenario` 擇一 |
| `scenario` | 情境物件，與 `buildScenario` 擇一（施壓前即檢查格式） |
| `getSessions` | 取得 session 之函數，傳入虛擬使用者數 `n`，回傳 `n` 個 session 物件之陣列；預設不使用 session |
| `releaseSessions` | 釋放 session 之函數，傳入 session 陣列，回傳未能釋放者之陣列（存於 `fpPending`）；拋錯或回傳非陣列時視為全部未能釋放 |
| `fpPending` | 未能釋放之 session 之存檔路徑（含 session 之值，宜置於不入版控之處），預設結果資料夾之 `sessions_pending.json`；指定之路徑無法寫入時改存結果資料夾內 |
| `mode` | `level`（預設，逐級）或 `smoke`（1 位虛擬使用者走 1 趟） |
| `levels` | 逐級之同時在線人數（正整數，不得重複），預設 `[10, 25, 50, 75, 100, 150, 200]` |
| `ramp`、`dur`、`gap` | 每級之爬升時間（預設 `30s`）、持續時間（預設 `3m`），皆為 k6 之時間格式，須帶單位（如 `30s`、`3m`、`1m30s`、`500ms`；k6 將裸數字視為毫秒，故不接受）；級間休息秒數（預設 `30`） |
| `batchPerHost` | 同一步之請求對同一主機之並行連線數，預設 `6`（同瀏覽器） |
| `gate` | 安全閘與門檻之覆寫，鍵為 `failRate`、`appErrRate`、`p95Ms`、`timeout`、`nameP95Ms`（預設見 `src/config.mjs` 之 `GATE`） |
| `label` | 結果資料夾之標籤，不得含路徑分隔或檔名禁用字元，預設由模式與級距組成 |
| `k6Path` | 指定之 k6 執行檔，給予則不經 `ensureBins` 取得（不下載、不校驗） |
| `offline` | 不連網，只用快取與 `W_BIN_MIRROR` 鏡像內已備之 k6，預設 `false`（`true` 等同環境變數 `W_BIN_OFFLINE=1`） |
| `procPorts` | 記錄資源之行程鍵名對埠號，例如 `{ api: 8000 }` |
| `labels` | 請求分組、計時與行程之顯示名稱 |
| `meta` | 附加於 meta.json 之使用方資訊物件，或於取得 session 與情境後產生之函數（傳入 `{ sessions, scenario }`）；不得含 session 之值 |
| `quiet` | 不將 k6 之輸出顯示於主控台（一律寫入 k6.log），預設 `false` |

- 安全閘：連線失敗比例超過 5%、內容檢核失敗比例超過 5%，或全部請求 95% 之回應時間超過 8 秒（恰等於上限不算超過；上限設為 `0` 即零容忍），即中止該級（20 秒後開始判斷）且不再加壓；該級無有效彙總（k6 未完整結束）亦視為觸發；單一請求逾 60 秒未回應視為失敗。各分組 95% 之回應時間超過 2 秒者於報告標示，不中止。
- 回傳 `{ fdRun, report, levels, pending }`：`levels` 為各級之 `{ vus, code, gate }`，`pending` 為未能釋放之 session。
- 參數與固定之情境於下載 k6、取 session 之前即檢查，格式有誤直接拋錯並指出欄位（含 `ramp`／`dur` 之時間格式、`procPorts` 之埠號、情境中 `check` 等欄位之型別），不會等到施壓開始才失敗。

#### session 與遮蔽
各 session 為一個物件，其值以 `{{鍵}}` 代入請求；第 i 位虛擬使用者取第 `(i - 1) % 長度` 個。含 session 之清單檔於結束時刪除；k6.log 與 meta.json 中長度 8 以上之 session 值遮蔽為 `<鍵>`。

取得 session 後任何失敗（情境格式有誤、k6 執行失敗等）皆會呼叫 `releaseSessions`，其拋錯不會遮蓋原本的錯誤。執行中以 Ctrl+C 等方式強制終止行程時則無法釋放，且結果資料夾內的 `.manifest.json`（含 session 之值）會留存，須自行處理。

#### 外部執行檔
本套件執行時需要下列外部執行檔，不含於 npm 包（npm 包內只有清單 `bin/manifest.json`）：

| 檔名 | 用途 | 來源 |
| --- | --- | --- |
| `k6.exe` | 施壓（k6 官方 Windows 版） | k6 官方發布（`https://github.com/grafana/k6/releases/download/<版本標籤>/k6-<版本標籤>-windows-amd64.zip`，不鏡像於本套件 repo） |

k6 為單一執行檔，不需安裝；k6 腳本（`src/k6Scenario.js`）不引用網路上之函式庫，施壓期間不需外網。

- 首次使用（不給 `k6Path` 而執行 `WScanStress`，或呼叫 `WScanStress.ensureBins()` 或 `w-scan-stress/src/ensureBins.mjs`）時才取得：依 `bin/manifest.json` 所載之 SHA-256 與大小校驗 zip 與解出之 `k6.exe`，存於 `<套件根>/bin-cache/<sha256>/k6.exe`；之後自快取取得（亦校驗）。安裝時不下載。取得失敗（含校驗不符）以帶 `code` 之 Error 拒絕（`E_OFFLINE_MISSING`、`E_HASH_MISMATCH`、`E_SIZE_MISMATCH`、`E_HTTP`、`E_EXTRACT` 等），並於取 session、建立結果資料夾之前。
- 本套件採**主幹模式**（壓測工具須保持新版）：連網時先取 GitHub 主幹 `bin/manifest.json` 之最新清單（版本標籤之資產網址與雜湊），取不到或不合格式時用 npm 包內之基準清單；因此更新 k6 版本只須更新並推送主幹之清單，不須重新發布套件。清單之信任錨為 GitHub 主幹，`ensureBins` 不接受使用者傳入的清單網址。離線（`W_BIN_OFFLINE=1` 或 `offline: true`）時不取主幹清單，直接用包內基準清單。
- 環境變數：
  - `W_BIN_CACHE=<資料夾>`：快取改放 `<資料夾>/w-scan-stress/`（套件所在之 `node_modules` 唯讀時使用，多套件可共用同一資料夾）。
  - `W_BIN_MIRROR=<資料夾或 http(s) 網址>`：內網鏡像，先找鏡像再連 GitHub；結構為 `<鏡像>/w-scan-stress/<sha256>/<檔名>`（最終檔 `k6.exe` 或 zip）。鏡像之檔同樣以清單校驗，不符即不用。
  - `W_BIN_OFFLINE=1`：不連網，只用快取與鏡像；缺檔時錯誤（`E_OFFLINE_MISSING`）會列出缺哪些檔、sha256、大小與應放之完整路徑。`WScanStress` 之 `offline: true` 與之等效。
- 離線（內網）部署：
  1. 在可連網之電腦設 `W_BIN_CACHE=<空資料夾>`，呼叫 `WScanStress.ensureBins()` 一次（`node -e "import('w-scan-stress/src/ensureBins.mjs').then((m) => m.default())"`）。
  2. 把該資料夾整個帶到內網電腦，設 `W_BIN_MIRROR=<該資料夾>`（全離線時另設 `W_BIN_OFFLINE=1`）。
  3. 亦可自 k6 官方取得 Windows 版自行置入鏡像（`<鏡像>/w-scan-stress/<sha256>/k6.exe`，須為清單所載版本之位元組），或以 `k6Path` 指定本機已有之 k6（不校驗）。
- 更新 k6（維護者）：`node toolg/genBinManifest.mjs`（查 k6 官方最新版 → 下載 Windows zip 與廠商公告之 checksums 檔 → 核對 sha256、大小 → 自算解出之 `k6.exe` 之校驗值 → 寫入 `bin/manifest.json`）；`--tag v2.3.0` 指定版本，`--dry` 乾跑（不寫檔，只印結果與相對現行清單之差異）。產生後跑測試，再推 GitHub 主幹即生效；包內基準清單於下次發布時更新。

#### Breaking changes
- k6 之取得改經 `ensureBins`（wsemi `fsEnsureBins`）：依 `bin/manifest.json` 以版本標籤之資產網址下載並校驗 SHA-256 與大小；不再查詢 GitHub API 之 `releases/latest`，下載結果也不再免校驗。
- 移除 `src/download.mjs`（`ensureTool`、`ensureAllTools`、`findLatestCached`、`installVerDir`、`cmpVerDesc`）與 `config.mjs` 之 `TOOLS`；k6 之版本不再由執行當下的 latest release 決定，而由清單決定。
- 移除選項 `fdTools`（k6 存放資料夾，原預設 `fdOut/tools`，內容為 `k6/<版本>/…`）：改為快取 `<套件根>/bin-cache/<sha256>/k6.exe`，位置由環境變數 `W_BIN_CACHE`（或 `ensureBins({ cacheDir })`）決定；`fdOut` 不再存放 k6。給了 `fdTools` 即拒絕（錯誤訊息指向 `W_BIN_CACHE` 與 `k6Path`）。原放在 `fdTools/k6/<版本>/` 之 k6 不會被沿用；內網部署請改依上節以鏡像備檔。
- `offline: true` 之語意為「只用快取與 `W_BIN_MIRROR` 鏡像」；無法連網時不再「自動沿用快取中最新版本」，快取或鏡像沒有清單所載版本之 k6 時改為拒絕（`E_OFFLINE_MISSING`）。
- 新增 `WScanStress.ensureBins` 與 `w-scan-stress/src/ensureBins.mjs`；新增環境變數 `W_BIN_CACHE`、`W_BIN_MIRROR`、`W_BIN_OFFLINE`；新增相依 `wsemi`。
- 受影響之下游：以 `fdTools` 預放 k6 之使用方（含內網部署腳本），以及自行讀取 `fdOut/tools/k6/` 之程式。

#### 擷取（`src/capture.mjs`）
以瀏覽器（playwright）依注入之步驟操作網頁，記錄網頁送往各服務之請求，作為組成情境之依據；網頁改版後重新擷取並與上次比對。登入狀態由 `prepare` 或步驟注入，請求本體由 `decode` 解讀，瀏覽器亦可由 `launchBrowser` 注入。內網或無法下載 playwright 之瀏覽器時，以 `browserChannel: 'chrome'`（或 `'msedge'`）使用本機已安裝之瀏覽器。

```alias
import capture from 'w-scan-stress/src/capture.mjs'

let r = await capture('./test/capture.json', {
    url: 'http://localhost:8080', //網頁網址
    prepare: async ({ page, url }) => { //寫入登入狀態(如 localStorage 之令牌)
        await page.goto(`${url}/favicon.ico`).catch(() => {})
        await page.evaluate((t) => localStorage.setItem('<site>:token', t), '<令牌>')
    },
    steps: [
        { name: '進入首頁', run: ({ page, url }) => page.goto(url), waitMs: 12000 },
        { name: '系統A', run: ({ page }) => page.locator('div', { hasText: '系統A' }).last().click(), waitMs: 8000 },
    ],
    classify: ({ url, resourceType }) => url.pathname.startsWith('/api/') ? 'api' : 'static', //服務之分類
    decode: ({ reqBody, resBody }) => ({}), //解讀請求本體, 回傳併入紀錄之欄位
    fpBase: './test/capture_last.json', //上次之擷取結果, 給予則比對
    browserChannel: 'chrome',
})
// => { fpOut, nReqs, nStatic, failedSteps, diff: { nBase, nNow, added, removed } }
```

步驟執行失敗時印出訊息並繼續後續步驟，失敗之階段記於 `failedSteps`（亦存於擷取結果），可據以判斷擷取是否完整。

#### 報告與對照
```alias
import { buildReport } from 'w-scan-stress/src/report.mjs'
import { buildCompare } from 'w-scan-stress/src/compare.mjs'

console.log(buildReport('./test/output/<結果資料夾>')) //各級總覽、計時、各分組p95對照與各級明細
console.log(buildCompare('<前>/vus050/summary.json', '<後>/vus050/summary.json', { labA: '改善前', labB: '改善後' })) //相同參數之兩次結果對照
```

#### Notes
- 施壓期間勿進行其他測試或重啟受測之服務，否則結果失真。
- 測試工具與受測之服務同在一台主機時，k6 本身亦佔用處理器；報告列出整機之處理器使用率供判斷。
- 受測系統若對每個登入狀態限制呼叫次數，應以 `getSessions` 為每位虛擬使用者各自登入，勿共用。
- 連網取得 k6 時，主幹模式每次呼叫先取一次 GitHub 主幹之清單（`raw.githubusercontent.com`，不受 GitHub API 每小時 60 次之限制）；快取命中時不再下載 zip。
