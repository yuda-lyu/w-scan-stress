// 示範與測試用之服務(node:http): 以帳號密碼登入取得令牌, 其餘 API 須帶令牌(Authorization: Bearer <令牌>), 結束時登出
// 供 g.mjs 之範例與測試使用, 實際使用時換成受測之系統
import http from 'node:http'
import crypto from 'node:crypto'


//PAGE, 示範網頁: 自 localStorage 之 demo:token 取令牌, 以 XMLHttpRequest 送出二進位本體(Blob)查詢, 並以 fetch 取清單(網址帶令牌)
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>demo</title></head><body><div id="app">demo</div><script>
const t = localStorage.getItem('demo:token') || ''
const x = new XMLHttpRequest()
x.open('POST', '/api/query')
x.setRequestHeader('Authorization', 'Bearer ' + t)
x.send(new Blob([new Uint8Array([1, 2, 3, 4, 5])]))
fetch('/api/list?token=' + t, { headers: { Authorization: 'Bearer ' + t } })
</script></body></html>`


/**
 * 啟動示範服務
 *
 * 網頁：GET / 回傳示範網頁(不須令牌)，見PAGE
 *
 * API(回應皆為JSON {state,msg})：
 *   POST /api/login 本體{account,password}，帳號demo、密碼demo-pass者回傳{state:'success',msg:{token}}，否則401
 *   POST /api/logout 帶令牌，刪除該令牌
 *   GET /api/profile 帶令牌，回傳登入者
 *   GET /api/list 帶令牌，回傳50筆(延遲opt.delayMs毫秒)
 *   POST /api/query 帶令牌，本體為二進位，回傳其位元組數
 *   POST /api/echo 帶令牌，回傳本體之文字
 *   GET /api/poll 帶令牌，回傳成功
 *   GET /api/fail 帶令牌，回傳{state:'error'}(狀態碼200，供內容檢核失敗之測試)
 *   令牌無效者一律401
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Number} [opt.port=8090] 輸入埠號
 * @param {Number} [opt.delayMs=20] 輸入/api/list之延遲毫秒數
 * @returns {Promise} 回傳Promise，resolve回傳{url,port,tokens,close}，tokens為現存令牌之Set，close為關閉服務之函數
 */
async function startDemoServer(opt = {}) {
    const port = opt.port || 8090
    const delayMs = opt.delayMs ?? 20
    const tokens = new Set()

    const send = (res, code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(obj))
    }
    const readBody = (req) => new Promise((resolve) => {
        const bufs = []
        req.on('data', (b) => bufs.push(b))
        req.on('end', () => resolve(Buffer.concat(bufs)))
    })

    const srv = http.createServer(async (req, res) => {
        const u = new URL(req.url, `http://${req.headers.host}`)
        const body = await readBody(req)
        if (req.method === 'POST' && u.pathname === '/api/login') {
            let j = {}
            try {
                j = JSON.parse(body.toString('utf8'))
            }
            catch (err) {}
            if (j.account !== 'demo' || j.password !== 'demo-pass') return send(res, 401, { state: 'error', msg: '帳號或密碼錯誤' })
            const token = crypto.randomBytes(16).toString('hex')
            tokens.add(token)
            return send(res, 200, { state: 'success', msg: { token } })
        }
        if (req.method === 'GET' && u.pathname === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            return res.end(PAGE)
        }
        const token = String(req.headers.authorization || '').replace(/^Bearer /, '')
        if (!tokens.has(token)) return send(res, 401, { state: 'error', msg: '令牌無效' })
        if (req.method === 'POST' && u.pathname === '/api/logout') {
            tokens.delete(token)
            return send(res, 200, { state: 'success', msg: 'ok' })
        }
        if (req.method === 'GET' && u.pathname === '/api/profile') return send(res, 200, { state: 'success', msg: { name: 'demo' } })
        if (req.method === 'GET' && u.pathname === '/api/list') {
            await new Promise((resolve) => setTimeout(resolve, delayMs))
            return send(res, 200, { state: 'success', msg: Array.from({ length: 50 }, (v, i) => ({ id: i + 1 })) })
        }
        if (req.method === 'POST' && u.pathname === '/api/query') return send(res, 200, { state: 'success', msg: { bytes: body.length } })
        if (req.method === 'POST' && u.pathname === '/api/echo') return send(res, 200, { state: 'success', msg: body.toString('utf8') })
        if (req.method === 'GET' && u.pathname === '/api/poll') return send(res, 200, { state: 'success', msg: 'ok' })
        if (req.method === 'GET' && u.pathname === '/api/fail') return send(res, 200, { state: 'error', msg: '示範之處理失敗' })
        return send(res, 404, { state: 'error', msg: 'not found' })
    })
    await new Promise((resolve, reject) => {
        srv.once('error', reject)
        srv.listen(port, '127.0.0.1', resolve)
    })
    const close = () => new Promise((resolve) => {
        srv.closeAllConnections()
        srv.close(() => resolve())
    })
    return { url: `http://127.0.0.1:${port}`, port, tokens, close }
}


export default startDemoServer
