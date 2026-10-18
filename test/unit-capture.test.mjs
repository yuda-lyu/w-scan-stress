//
// unit: 以瀏覽器擷取網頁之請求(src/capture.mjs), 以示範服務(test/tools/demoServer.mjs, 埠 8092)之示範網頁為對象
//
// 對應規則(src/capture.mjs 之說明, README 之〈擷取〉):
//   依序執行 steps, 每步為一個階段(S1_<名稱>、S2_<名稱>…), 期間完成之請求記入該階段; prepare 於開始前執行(注入登入狀態);
//   只記錄 origins 內之來源; 依 classify 分類, 'static' 只計數、'' 不記錄、其餘逐筆記錄(預設 XHR 與 fetch 為 'api');
//   XMLHttpRequest 送出之二進位本體(Blob)經攔截後交 decode 解讀, decode 之回傳併入紀錄; 網址之查詢參數名含 token 等者遮蔽為 <masked>;
//   擷取結果存於 fpOut; 步驟失敗時印出訊息並繼續後續步驟, 失敗之階段記於 failedSteps; 給 fpBase 則與上次比對各階段之請求(以 keyOf 取鍵、skip 者不比對);
//   給 launchBrowser 則以其回傳之瀏覽器擷取, 結束時關閉之;
//   請求歸屬於其完成當下之階段(不因處理延遲而移到下一階段); 事件處理之錯誤不成為未處理之 rejection, 收尾時以原錯誤 reject 並關閉瀏覽器;
//   收尾時排空事件工作(等待期間才完成之請求不遺漏); fpBase 與 fpOut 為同一檔案時先讀取上次結果再覆寫(以假瀏覽器驗證, 不需 playwright 之瀏覽器)
//   (需 playwright 之 chromium)
//
import { strict as assert } from 'assert'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import capture, { diffCapture, maskUrlDef } from '../src/capture.mjs'
import startDemoServer from './tools/demoServer.mjs'


describe('capture: maskUrlDef、diffCapture', function () {

    it('maskUrlDef: 查詢參數名含 token、key、secret、password、auth 者遮蔽', function () {
        //規則: 查詢參數名含token、key、secret、password、auth者改為<masked>
        assert.equal(maskUrlDef(new URL('http://a/b?token=x&apiKey=y&n=1&Authorization=z')), '/b?token=<masked>&apiKey=<masked>&n=1&Authorization=<masked>')
        assert.equal(maskUrlDef(new URL('http://a/b')), '/b')
    })

    it('diffCapture: 階段以序號比對, skip 者不比對', function () {
        let base = [{ stage: 'S1_首頁', path: '/a' }, { stage: 'S2_甲', path: '/b' }, { stage: 'S2_甲', path: '/poll' }]
        let now = [{ stage: 'S1_進入', path: '/a' }, { stage: 'S2_甲', path: '/c' }, { stage: 'S3_乙', path: '/poll' }]
        let r = diffCapture(base, now, { skip: (q) => q.path === '/poll' })
        //規則: 階段以序號(S1、S2…)比對, 名稱不同不影響
        assert.deepEqual(r, { nBase: 2, nNow: 2, added: ['S2 | /c'], removed: ['S2 | /b'] })
        //規則: keyOf 預設取 func 或 path
        assert.deepEqual(diffCapture([{ stage: 'S1', func: 'f', path: '/main' }], [{ stage: 'S1', func: 'g', path: '/main' }]).added, ['S1 | g'])
    })

})


describe('capture: 實擷', function () {
    this.timeout(120000)

    let fd = path.resolve('./test/_tmp/capture')
    let demo
    let token

    before(async function () {
        fs.rmSync(fd, { recursive: true, force: true })
        demo = await startDemoServer({ port: 8092 })
        let res = await fetch(`${demo.url}/api/login`, { method: 'POST', body: JSON.stringify({ account: 'demo', password: 'demo-pass' }) })
        token = (await res.json()).msg.token
    })

    after(async function () {
        await demo.close()
        fs.rmSync(fd, { recursive: true, force: true })
        assert.ok(!fs.existsSync(fd))
    })

    it('依步驟擷取, 攔截二進位本體交 decode, 遮蔽網址之令牌, 與上次比對', async function () {
        let fpOut = path.join(fd, 'cap.json')
        let fpBase = path.join(fd, 'cap_base.json')
        fs.mkdirSync(fd, { recursive: true })
        fs.writeFileSync(fpBase, JSON.stringify({ reqs: [{ stage: 'S1_x', path: '/api/query' }, { stage: 'S1_x', path: '/api/old' }] }), 'utf8')
        let decoded = []
        let r = await capture(fpOut, {
            url: demo.url,
            //規則: prepare 於開始前執行(注入登入狀態)
            prepare: async ({ page, url }) => {
                await page.goto(`${url}/api/none`).catch(() => {})
                await page.evaluate((t) => localStorage.setItem('demo:token', t), token)
            },
            steps: [
                { name: '進入', run: ({ page, url }) => page.goto(url), waitMs: 1500 },
                { name: '輪詢', run: ({ page }) => page.evaluate((t) => fetch('/api/poll', { headers: { Authorization: 'Bearer ' + t } }), token), waitMs: 500 },
            ],
            classify: ({ url, resourceType }) => {
                if (url.pathname === '/api/none') return '' //規則: '' 不記錄
                return (resourceType === 'xhr' || resourceType === 'fetch') ? 'api' : 'static'
            },
            decode: ({ method, url, reqBody, resBody }) => {
                decoded.push(url.pathname)
                if (url.pathname !== '/api/query') return {}
                return { func: 'query', nIn: [...reqBody].join(','), out: JSON.parse(resBody.toString('utf8')).msg.bytes }
            },
            fpBase,
            diff: { keyOf: (q) => q.path.split('?')[0] },
        })

        let j = JSON.parse(fs.readFileSync(fpOut, 'utf8'))
        let rq = (p) => j.reqs.find((q) => q.path.startsWith(p))
        //規則: 擷取結果存於fpOut
        assert.equal(r.fpOut, fpOut)
        //規則: 全部步驟成功者failedSteps為空陣列(回傳與fpOut皆有)
        assert.deepEqual(r.failedSteps, [])
        assert.deepEqual(j.failedSteps, [])
        assert.equal(r.nReqs, j.reqs.length)
        //規則: 每步為一個階段, 期間完成之請求記入該階段
        assert.deepEqual(j.reqs.map((q) => `${q.stage} ${q.method} ${q.path.split('?')[0]}`).sort(), ['S1_進入 GET /api/list', 'S1_進入 POST /api/query', 'S2_輪詢 GET /api/poll'])
        //規則: XMLHttpRequest之二進位本體(Blob)經攔截後交decode解讀, decode之回傳併入紀錄
        assert.deepEqual([rq('/api/query').func, rq('/api/query').nIn, rq('/api/query').out, rq('/api/query').reqBytes], ['query', '1,2,3,4,5', 5, 5])
        //規則: 預設XHR與fetch為api
        assert.equal(rq('/api/list').svc, 'api')
        assert.equal(rq('/api/list').status, 200)
        //規則: 網址之查詢參數名含token者遮蔽
        assert.equal(rq('/api/list').path, '/api/list?token=<masked>')
        //規則: 'static'只計數(示範網頁本身)
        assert.ok(r.nStatic['S1_進入'] >= 1, JSON.stringify(r.nStatic))
        //規則: ''不記錄(亦不交decode)
        assert.ok(!decoded.includes('/api/none'))
        //規則: 擷取結果不含令牌
        assert.ok(!fs.readFileSync(fpOut, 'utf8').includes(token))
        //規則: 與上次比對各階段之請求(以keyOf取鍵)
        assert.deepEqual(r.diff.added.sort(), ['S1 | /api/list', 'S2 | /api/poll'])
        assert.deepEqual(r.diff.removed, ['S1 | /api/old'])
    })

    it('步驟失敗: 繼續後續步驟, 失敗之階段記於 failedSteps(不被吞掉)', async function () {
        let logs = []
        let log0 = console.log
        console.log = (m) => logs.push(String(m))
        let r
        try {
            r = await capture(path.join(fd, 'cap_fail.json'), {
                url: demo.url,
                steps: [
                    { name: '進入', run: ({ page, url }) => page.goto(url), waitMs: 500 },
                    {
                        name: '壞',
                        run: () => {
                            throw new Error('boom')
                        },
                    },
                    { name: '輪詢', run: ({ page }) => page.evaluate(() => fetch('/api/poll')), waitMs: 500 },
                ],
            })
        }
        finally {
            console.log = log0
        }
        //規則: 步驟失敗時繼續後續步驟, 失敗之階段記於failedSteps(回傳與fpOut皆有), 並印出訊息
        assert.deepEqual(r.failedSteps, ['S2_壞'])
        let j = JSON.parse(fs.readFileSync(r.fpOut, 'utf8'))
        assert.deepEqual(j.failedSteps, ['S2_壞'])
        assert.ok(j.reqs.some((q) => q.stage === 'S3_輪詢' && q.path === '/api/poll'), JSON.stringify(j.reqs))
        assert.ok(logs.some((s) => s.includes('步驟[S2_壞]失敗: boom')), logs.join('\n'))
    })

    it('launchBrowser 注入: 以其回傳之瀏覽器擷取, 結束時關閉之', async function () {
        let browser = null
        let r = await capture(path.join(fd, 'cap_launch.json'), {
            url: demo.url,
            //規則: 給予 launchBrowser 則以其回傳之瀏覽器擷取
            launchBrowser: async () => {
                browser = await chromium.launch()
                return browser
            },
            //規則: 未給 steps 時預設開啟 opt.url(此處縮短等待)
            steps: [{ name: 'entry', run: ({ page, url }) => page.goto(url), waitMs: 1000 }],
        })
        assert.ok(browser)
        //規則: 擷取結束時關閉之
        assert.equal(browser.isConnected(), false)
        //規則: 預設 XHR 與 fetch 為 api(示範網頁發出 2 個, 未注入令牌而回 401 亦記錄)
        assert.deepEqual(JSON.parse(fs.readFileSync(r.fpOut, 'utf8')).reqs.map((q) => `${q.svc} ${q.status} ${q.path}`).sort(), ['api 401 /api/list?token=<masked>', 'api 401 /api/query'])
    })

})


describe('capture: 事件處理(假瀏覽器, 不需 playwright 之瀏覽器)', function () {
    this.timeout(30000)

    let fd = path.resolve('./test/_tmp/capture_fake')
    let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    let U = 'http://127.0.0.1:8099'

    before(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
    })

    after(function () {
        fs.rmSync(fd, { recursive: true, force: true })
        assert.ok(!fs.existsSync(fd))
    })

    //fakeBrowser, 只實作 capture 用到之介面; page 為 EventEmitter, 以 emit('requestfinished', req) 模擬請求完成
    let fakeBrowser = () => {
        let page = new EventEmitter()
        page.exposeFunction = async () => {}
        page.addInitScript = async () => {}
        page.waitForTimeout = (ms) => sleep(ms)
        let browser = {
            closed: false,
            newContext: async () => ({ newPage: async () => page }),
            close: async () => {
                browser.closed = true
            },
        }
        return { browser, page }
    }

    //fakeReq, 回應延遲 delayMs 毫秒
    let fakeReq = (p, delayMs = 0) => ({
        url: () => `${U}${p}`,
        resourceType: () => 'xhr',
        response: async () => {
            await sleep(delayMs)
            return { status: () => 200, body: async () => Buffer.from('ok'), headers: () => ({}) }
        },
        headers: () => ({}),
        postDataBuffer: () => null,
        timing: () => ({ responseEnd: 5, requestStart: 1 }),
        method: () => 'GET',
    })

    it('請求歸屬於其完成當下之階段, 不因處理延遲而移到下一階段', async function () {
        let { browser, page } = fakeBrowser()
        let r = await capture(path.join(fd, 'stage.json'), {
            url: U,
            launchBrowser: async () => browser,
            steps: [
                {
                    name: 'first',
                    run: () => {
                        page.emit('requestfinished', fakeReq('/a', 300)) //回應 300ms 後才處理完, 此時流程已進入第 2 階段
                    },
                },
                { name: 'second', run: () => {}, waitMs: 500 },
            ],
        })
        //規則: 請求完成當下屬於第1階段者記入第1階段(階段於事件發生當下擷取, 不在之後的 await 才讀取)
        let j = JSON.parse(fs.readFileSync(r.fpOut, 'utf8'))
        assert.deepEqual(j.reqs.map((q) => `${q.stage} ${q.path}`), ['S1_first /a'])
    })

    it('事件處理拋錯: 不成為未處理之 rejection, 收尾時以原錯誤 reject 並關閉瀏覽器', async function () {
        let { browser, page } = fakeBrowser()
        let unhandled = []
        let h = (reason) => unhandled.push(reason)
        let listeners = process.listeners('unhandledRejection')
        process.removeAllListeners('unhandledRejection') //暫時移除 mocha 之處理, 以觀察是否有未處理之 rejection
        process.on('unhandledRejection', h)
        let err
        try {
            err = await capture(path.join(fd, 'err.json'), {
                url: U,
                launchBrowser: async () => browser,
                classify: () => {
                    throw new Error('classifier failed')
                },
                steps: [{
                    name: 'one',
                    run: () => {
                        page.emit('requestfinished', fakeReq('/a'))
                    },
                    waitMs: 300,
                }],
            }).then(() => null, (e) => e)
            await sleep(50)
        }
        finally {
            process.removeListener('unhandledRejection', h)
            for (let l of listeners) process.on('unhandledRejection', l)
        }
        //規則: 事件處理之錯誤於建立工作當下即接上處理(收尾統一拋出), 不留下暫時未被處理之rejected Promise
        assert.deepEqual(unhandled.map((e) => e.message), [])
        assert.ok(err && /classifier failed/.test(err.message), String(err))
        //規則: 失敗時仍關閉瀏覽器
        assert.equal(browser.closed, true)
    })

    it('收尾時排空事件工作: 等待期間才完成之請求不遺漏', async function () {
        let { browser, page } = fakeBrowser()
        let r = await capture(path.join(fd, 'drain.json'), {
            url: U,
            launchBrowser: async () => browser,
            steps: [{
                name: 'one',
                run: () => {
                    page.emit('requestfinished', fakeReq('/a', 300)) //約 300ms 處理完
                    setTimeout(() => page.emit('requestfinished', fakeReq('/b', 300)), 200) //於 A 處理期間才完成, 約 500ms 處理完
                },
            }],
        })
        //規則: 收尾時重複等待直到事件工作不再增加, 之後才存檔與關閉瀏覽器
        assert.equal(r.nReqs, 2)
        assert.deepEqual(JSON.parse(fs.readFileSync(r.fpOut, 'utf8')).reqs.map((q) => q.path).sort(), ['/a', '/b'])
        assert.equal(browser.closed, true)
    })

    it('fpBase 與 fpOut 為同一檔案: 先讀取上次結果再覆寫, 比對不落空', async function () {
        let fp = path.join(fd, 'same.json')
        fs.writeFileSync(fp, JSON.stringify({ reqs: [{ stage: 'S1_one', path: '/old' }] }), 'utf8')
        let { browser, page } = fakeBrowser()
        let r = await capture(fp, {
            url: U,
            launchBrowser: async () => browser,
            steps: [{
                name: 'one',
                run: () => {
                    page.emit('requestfinished', fakeReq('/new'))
                },
                waitMs: 100,
            }],
            fpBase: fp,
        })
        //規則: 上次之結果須在寫入fpOut之前讀取; 同一檔案時不得先覆寫而與自己比對
        assert.deepEqual(r.diff.added, ['S1 | /new'])
        assert.deepEqual(r.diff.removed, ['S1 | /old'])
    })

})
