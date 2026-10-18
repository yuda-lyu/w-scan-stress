// 擷取:以瀏覽器(playwright)依使用方注入之步驟操作網頁, 記錄網頁送往各服務之請求, 作為組成情境(scenario)之依據;
// 網頁改版後重新擷取, 並與上次之擷取結果比對. 本模組不含任何特定系統之登入或編碼: 登入狀態由 opt.prepare 注入, 請求本體由 opt.decode 解讀
//
// 請求本體: 網頁以 XMLHttpRequest 送出 Blob 或 ArrayBuffer 時, playwright 之 postDataBuffer 取不到, 故於頁面內攔截 XMLHttpRequest.send 讀出本體回傳,
//   並加標頭 X-Cap-Id 供對應(opt.interceptXhrBody 為 false 時不攔截; 跨來源之請求加標頭會觸發預檢, 須伺服器允許該標頭)
import fs from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from 'playwright'


/**
 * 預設之網址遮蔽：查詢參數名含token、key、secret、password、auth者改為<masked>
 *
 * @param {URL} u 輸入網址物件
 * @returns {String} 回傳路徑與查詢字串
 */
export function maskUrlDef(u) {
    const v = new URL(u.href)
    for (const k of [...v.searchParams.keys()]) {
        if (/token|key|secret|password|auth/i.test(k)) v.searchParams.set(k, '<masked>')
    }
    return (v.pathname + v.search).replace(/%3Cmasked%3E/g, '<masked>')
}


/**
 * 比對兩次擷取之各階段請求，階段以序號(S1、S2…)比對，請求以opt.keyOf取鍵
 *
 * @param {Array} reqsBase 輸入上次之請求陣列
 * @param {Array} reqs 輸入本次之請求陣列
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Function} [opt.keyOf] 輸入請求之比對鍵函數，傳入請求紀錄，預設取r.func或r.path
 * @param {Function} [opt.skip] 輸入不比對之請求判斷函數(如輪詢)，傳入請求紀錄回傳布林值，預設皆比對
 * @returns {Object} 回傳{nBase,nNow,added,removed}
 */
export function diffCapture(reqsBase, reqs, opt = {}) {
    const keyOfReq = opt.keyOf || ((r) => r.func || r.path)
    const skip = opt.skip || (() => false)
    const keyOf = (r) => `${String(r.stage).split('_')[0]} | ${keyOfReq(r)}`
    const sb = new Set(reqsBase.filter((r) => !skip(r)).map(keyOf))
    const sn = new Set(reqs.filter((r) => !skip(r)).map(keyOf))
    return {
        nBase: sb.size,
        nNow: sn.size,
        added: [...sn].filter((k) => !sb.has(k)),
        removed: [...sb].filter((k) => !sn.has(k)),
    }
}


/**
 * 以瀏覽器擷取網頁操作時所發出之請求
 *
 * 依序執行opt.steps，每步為一個階段(S1_<名稱>、S2_<名稱>…)，期間完成之請求記入該階段；步驟失敗時印出訊息並繼續後續步驟，失敗之階段記於failedSteps；
 * 只記錄opt.origins內之來源，其中XHR與fetch視為服務之請求逐筆記錄，其餘(網頁、腳本、樣式、圖片等)只計數
 *
 * 內網或無法下載playwright瀏覽器時，以opt.browserChannel使用本機已安裝之Chrome('chrome')或Edge('msedge')，或以opt.executablePath指定瀏覽器
 *
 * @param {String} fpOut 輸入擷取結果(JSON)之輸出路徑字串，內容為{time,url,nStatic,failedSteps,reqs}
 * @param {Object} opt 輸入設定物件
 * @param {String} opt.url 輸入網頁網址字串，必填
 * @param {Array} [opt.steps] 輸入步驟陣列，每步{name,run,waitMs}，run傳入{page,context,url}，執行完等待waitMs毫秒，預設[{name:'entry',run:開啟opt.url,waitMs:10000}]
 * @param {Function} [opt.prepare] 輸入開始前之準備函數，傳入{page,context,url}(如寫入登入狀態)
 * @param {Array} [opt.origins] 輸入記錄之來源陣列，預設[opt.url之來源]
 * @param {Function} [opt.classify] 輸入請求之服務分類函數，傳入{url,resourceType}，回傳服務鍵名、'static'(只計數)或''(不記錄)，預設XHR與fetch為'api'
 * @param {Function} [opt.decode] 輸入請求之解讀函數，傳入{method,url,reqBody,resBody,resHeaders,status}，回傳併入紀錄之欄位物件(如{func,args,rows})，不得回傳登入狀態之值
 * @param {Function} [opt.maskUrl] 輸入網址之遮蔽函數，傳入網址物件回傳紀錄之路徑字串，預設maskUrlDef
 * @param {Boolean} [opt.interceptXhrBody=true] 輸入是否攔截XMLHttpRequest之二進位本體布林值
 * @param {String} [opt.fpBase=''] 輸入上次之擷取結果路徑字串，給予則比對各階段之請求
 * @param {Object} [opt.diff] 輸入比對之設定物件，同diffCapture之opt
 * @param {Boolean} [opt.headless=true] 輸入是否無頭執行瀏覽器布林值
 * @param {String} [opt.browserChannel=''] 輸入使用本機瀏覽器之通道字串，例如'chrome'、'msedge'
 * @param {String} [opt.executablePath=''] 輸入瀏覽器執行檔路徑字串
 * @param {Function} [opt.launchBrowser] 輸入啟動瀏覽器之函數，回傳playwright之Browser(或其Promise)，給予則不使用opt.headless、opt.browserChannel、opt.executablePath，擷取結束時關閉之
 * @param {Object} [opt.viewport={width:1600,height:900}] 輸入視窗大小物件
 * @returns {Promise} 回傳Promise，resolve回傳{fpOut,nReqs,nStatic,failedSteps,diff}，failedSteps為失敗步驟之階段名稱陣列，diff為與上次之比對(未給opt.fpBase則為null)，reject回傳錯誤訊息
 */
async function capture(fpOut, opt = {}) {
    const url = String(opt.url || '')
    if (!url) throw new Error('須給網頁網址(opt.url)')
    const origins = opt.origins || [new URL(url).origin]
    const steps = opt.steps || [{ name: 'entry', run: ({ page }) => page.goto(url, { waitUntil: 'domcontentloaded' }), waitMs: 10000 }]
    const classify = opt.classify || (({ resourceType }) => (resourceType === 'xhr' || resourceType === 'fetch') ? 'api' : 'static')
    const maskUrl = opt.maskUrl || maskUrlDef
    const intercept = opt.interceptXhrBody !== false

    let browser
    if (typeof opt.launchBrowser === 'function') {
        browser = await opt.launchBrowser()
    }
    else {
        const lo = { headless: opt.headless !== false }
        if (opt.browserChannel) lo.channel = opt.browserChannel
        if (opt.executablePath) lo.executablePath = opt.executablePath
        browser = await chromium.launch(lo)
    }
    const reqs = []
    const nStatic = {}
    const failedSteps = []
    try {
        const context = await browser.newContext({ viewport: opt.viewport || { width: 1600, height: 900 } })
        const page = await context.newPage()

        //請求本體之攔截
        const kpBody = {}
        const waitBody = async (id) => {
            for (let i = 0; i < 20 && !kpBody[id]; i++) {
                await new Promise((resolve) => setTimeout(resolve, 100)) //本體由頁面非同步回傳, 最多等 2 秒
            }
        }
        if (intercept) {
            await page.exposeFunction('__capBody', (id, b64) => {
                kpBody[id] = Buffer.from(b64, 'base64')
            })
            await page.addInitScript(() => {
                const send = XMLHttpRequest.prototype.send
                let n = 0
                const toB64 = (u8) => {
                    let s = ''
                    for (let i = 0; i < u8.length; i += 0x8000) {
                        s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
                    }
                    return btoa(s)
                }
                XMLHttpRequest.prototype.send = function(body) {
                    try {
                        if (body && (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body))) {
                            n++
                            const id = `c${n}`
                            this.setRequestHeader('X-Cap-Id', id)
                            if (body instanceof Blob) {
                                body.arrayBuffer().then((ab) => window.__capBody(id, toB64(new Uint8Array(ab))))
                            }
                            else {
                                const u8 = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
                                window.__capBody(id, toB64(u8))
                            }
                        }
                    }
                    catch (err) {}
                    return send.call(this, body)
                }
            })
        }

        if (typeof opt.prepare === 'function') await opt.prepare({ page, context, url })

        let stage = ''
        const t0 = Date.now()
        const pending = []
        const errs = []
        let accepting = true
        page.on('requestfinished', (req) => {
            if (!accepting) return
            //階段與時點於事件發生當下擷取: 之後的 await 期間流程可能已進入下一個階段
            const stageAt = stage
            const tAt = Date.now() - t0
            //工作建立當下即接上錯誤處理(先記下, 收尾時統一拋出), 不留暫時未被處理的 rejected Promise
            pending.push((async () => {
                const u = new URL(req.url())
                if (!origins.includes(u.origin)) return
                const svc = classify({ url: u, resourceType: req.resourceType() })
                if (!svc) return
                if (svc === 'static') {
                    nStatic[stageAt] = (nStatic[stageAt] || 0) + 1
                    return
                }
                const res = await req.response()
                const resBody = res ? await res.body().catch(() => Buffer.alloc(0)) : Buffer.alloc(0)
                const idCap = req.headers()['x-cap-id'] || ''
                if (idCap) await waitBody(idCap)
                const reqBody = kpBody[idCap] || req.postDataBuffer() || Buffer.alloc(0)
                const tm = req.timing()
                const q = {
                    stage: stageAt,
                    t: tAt,
                    svc,
                    method: req.method(),
                    path: maskUrl(u),
                    status: res ? res.status() : 0,
                    reqBytes: reqBody.length,
                    resBytes: resBody.length,
                    ms: tm && tm.responseEnd > 0 ? Math.round(tm.responseEnd - tm.requestStart) : null,
                }
                if (typeof opt.decode === 'function') {
                    try {
                        Object.assign(q, await opt.decode({ method: q.method, url: u, reqBody, resBody, resHeaders: res ? res.headers() : {}, status: q.status }) || {})
                    }
                    catch (err) {
                        q.decodeError = String(err.message || err)
                    }
                }
                reqs.push(q)
            })().catch((err) => {
                errs.push(err)
            }))
        })

        //依序執行各步
        for (let i = 0; i < steps.length; i++) {
            const st = steps[i]
            stage = `S${i + 1}_${st.name || i + 1}`
            try {
                if (typeof st.run === 'function') await st.run({ page, context, url })
            }
            catch (err) {
                failedSteps.push(stage)
                console.log(`步驟[${stage}]失敗: ${String(err.message).split('\n')[0]}`)
            }
            if (st.waitMs > 0) await page.waitForTimeout(st.waitMs)
        }
        //排空事件工作: 等待期間可能又有請求完成而新增工作, 重複等待直到不再增加, 之後不再接收
        for (let n = -1; n < pending.length;) {
            n = pending.length
            await Promise.all(pending)
        }
        accepting = false
        if (errs.length > 0) throw errs[0]
    }
    finally {
        await browser.close()
    }

    //上次之結果須在寫入 fpOut 之前讀取: fpBase 與 fpOut 為同一檔案時, 先寫會覆寫基準而與自己比對
    let reqsBase = null
    if (opt.fpBase && fs.existsSync(opt.fpBase)) {
        try {
            reqsBase = JSON.parse(fs.readFileSync(opt.fpBase, 'utf8')).reqs || []
        }
        catch (err) {
            console.log(`無法讀取上次之擷取結果(${opt.fpBase}), 不比對: ${String(err.message).split('\n')[0]}`)
        }
    }

    reqs.sort((a, b) => a.t - b.t)
    fs.mkdirSync(dirname(fpOut), { recursive: true })
    fs.writeFileSync(fpOut, JSON.stringify({ time: new Date().toISOString(), url: maskUrl(new URL(url)), nStatic, failedSteps, reqs }, null, 1), 'utf8')
    console.log(`擷取 ${reqs.length} 個請求(不含只計數者), 已存 ${fpOut}${failedSteps.length ? `; 失敗之步驟: ${failedSteps.join('、')}` : ''}`)

    let diff = null
    if (reqsBase) {
        diff = diffCapture(reqsBase, reqs, opt.diff)
        console.log(`與上次比對(各階段之請求): 上次 ${diff.nBase} 項, 本次 ${diff.nNow} 項${diff.added.length || diff.removed.length ? '' : ', 一致'}`)
        for (const k of diff.added) console.log('  + 新增: ' + k)
        for (const k of diff.removed) console.log('  - 移除: ' + k)
    }
    return { fpOut, nReqs: reqs.length, nStatic, failedSteps, diff }
}


export default capture
