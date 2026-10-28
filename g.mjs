import wss from './src/WScanStress.mjs'
// import wss from './dist/w-scan-stress.umd.js'
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


//node g.mjs
