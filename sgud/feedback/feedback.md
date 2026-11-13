# 回饋(feedback)

只增不改:處置結果(已通報、已修、不採納)另記一列並寫明承接哪一列.欄位:日期、類別、對象、內容、依據.

| 日期 | 類別 | 對象 | 內容 | 依據 |
| --- | --- | --- | --- | --- |
| 2026-11-13 | 全域技能 | role-coder-for-test | 建議於 §1 第 6 條(包裝套到 N 個呼叫點須逐點接線測試)補一段「以真實瀏覽器為接縫時,修前紅與變異驗證不得啟動瀏覽器」之作法:①修前紅:先並存安裝新包裝、寫接線測試,再以空的 `PLAYWRIGHT_BROWSERS_PATH` 跑——仍直接引用舊套件者找不到執行檔而失敗,不會起任何瀏覽器;②測試用 `executablePath` 一律指向不存在之檔,接線失效時以執行檔優先而缺檔失敗,連通道(如 msedge)轉傳案也不會起真瀏覽器;③變異(改回直接引用、刪參數轉傳)亦在空瀏覽器路徑下跑.此作法使「修前不得啟動真瀏覽器」之紀律與「修前須先紅」並存;各使用端遷移輪會重複遇到 | `test/unit-capture.test.mjs`〈啟動經 w-playwright(接線)〉;修前紅 log `tmp/quiet-run/20261113-144956-pm-ss-red.log`(5 紅、0 啟動,登入錯誤次數 0→0);變異 log `…-pm-ss-mut1/mut2/mut3.log`;`sgud/exp/experience.md` 2026-11-13 條 |
| 2026-11-13 | 自有套件 | w-playwright | 低優先提案:提供不啟動瀏覽器的「受管瀏覽器是否已安裝」探測(如 `findManagedChromium({ kind })` 回路徑或 `''`,與 `findSystemChrome` 對稱),供使用端測試在未安裝時 `this.skip()` 並印出 `ensureChromium()` 提示;現況只有 `findSystemChrome`(系統 Chrome/Edge),使用 headless shell 的測試在未安裝時只能以 `E_BROWSER_MISSING` 失敗或自行 `ensureChromium()`(後者會連網下載).是否需要由主責判斷 | `test/unit-capture.test.mjs`〈實擷〉3 案需受管 headless shell;w-playwright `README.md` API 表僅有 `findSystemChrome`(讀 `src/findSystemChrome.mjs:24-35`) |
