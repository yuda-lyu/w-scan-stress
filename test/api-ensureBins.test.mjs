//
// api: 外部執行檔 k6.exe 之取得(src/ensureBins.mjs)與主函數之接線
//
// 對應規格: 外部執行檔之存放下載校驗與離線(制式規格, C:\opensrcOper\dspec) D1~D4、O1~O4、M5、E2、E3 與 §8 T3~T8
// 本套件為主幹模式(floating)之廠商檔: 清單 bin/manifest.json 記 k6 之版本標籤資產網址(zip)與解出之 k6.exe 之校驗值。
// k6 之真檔(zip 約 30MB)不入 repo, 故下載路徑以「與真清單同形」之合成清單驗證: 取真清單, 僅把 zip 與解出檔之 sha256、大小換成合成內容之值
// (網址、成員路徑、鍵名皆沿用真清單), 套件根為暫存夾內之副本(src/ensureBins.mjs 或整個 src/ 之副本＋合成清單)。
// 網路: 本機 HTTP 伺服器扮 raw.githubusercontent.com 與 github.com(fetch 只改主機指向本機), 其餘位址一律拋錯, 不連外網;
//   鏡像與快取為暫存夾內之真實資料夾。
//
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawnSync } from 'node:child_process'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { pathToFileURL } from 'node:url'
import ensureBinsReal from '../src/ensureBins.mjs'
import WScanStressReal, * as nsMain from '../src/WScanStress.mjs'
import { makeZip, hashBuf, hashFile, listFiles, flip, withEnv } from './tools/binFixtures.mjs'


const RAW = 'https://raw.githubusercontent.com'
const GH = 'https://github.com'
const PORT = 8094
const FDT = path.resolve('./test/_tmp/ensureBins')
const URL_TRUNK = `${RAW}/yuda-lyu/w-scan-stress/master/bin/manifest.json`


let catchErr = async (fun) => {
    try {
        await fun()
    }
    catch (err) {
        return err
    }
    return null
}


describe('ensureBins: 取得 k6.exe(合成清單與本機伺服器)', function () {
    this.timeout(120000)

    let real = null //真清單
    let rk = null
    let zipName = ''
    let tagA = ''
    let memberA = ''
    let exeA = null
    let zipA = null
    let synthA = null //與真清單同形之合成清單(版本 A)
    let hashExeA = null
    let hashZipA = null
    let tagB = 'v9.9.9'
    let exeB = null
    let zipB = null
    let synthB = null
    let hashExeB = null
    let urlA = ''
    let urlB = ''

    let server = null
    let hits = [] //伺服器收到之請求路徑
    let urls = [] //fetch 收到之原網址
    let mode = {} //伺服器行為: trunk('same'|'newer'|'500'|'invalid'|'wrongpkg')、zip('good'|'flip'|'short'|'missing')

    //fetch, 只接受 raw.githubusercontent.com 與 github.com 並改指本機伺服器, 其餘(外網)一律拋錯
    let fetch = (url, init) => {
        const u = String(url)
        urls.push(u)
        if (u.startsWith(`${RAW}/`)) return globalThis.fetch(u.replace(RAW, `http://127.0.0.1:${PORT}`), init)
        if (u.startsWith(`${GH}/`)) return globalThis.fetch(u.replace(GH, `http://127.0.0.1:${PORT}`), init)
        throw new Error(`unexpected url[${u}]`)
    }
    //fetchBan, 任何網路請求皆記錄並拋錯(用於斷言未連網)
    let banned = []
    let fetchBan = (url) => {
        banned.push(String(url))
        throw new Error(`network access is not allowed in this case[${url}]`)
    }

    let seq = 0
    let temps = []
    let newDir = (tag) => {
        seq++
        const fd = path.join(FDT, `${tag}-${seq}`)
        temps.push(fd)
        return fd
    }

    //mkRoot, 組一個假套件根(src/ensureBins.mjs 之副本＋指定之清單), 回傳載入之 ensureBins
    let mkRoot = async (manifest) => {
        const root = newDir('root')
        fs.mkdirSync(path.join(root, 'src'), { recursive: true })
        fs.mkdirSync(path.join(root, 'bin'), { recursive: true })
        fs.copyFileSync('src/ensureBins.mjs', path.join(root, 'src', 'ensureBins.mjs'))
        fs.writeFileSync(path.join(root, 'bin', 'manifest.json'), JSON.stringify(manifest))
        const mod = await import(pathToFileURL(path.join(root, 'src', 'ensureBins.mjs')).href)
        return { root, ensureBins: mod.default }
    }

    //seedMirror, 依鏡像結構(<鏡像>/<套件>/<sha256>/<name>)放入檔案
    let seedMirror = (mirror, sha256, name, buf) => {
        const fd = path.join(mirror, 'w-scan-stress', sha256)
        fs.mkdirSync(fd, { recursive: true })
        fs.writeFileSync(path.join(fd, name), buf)
    }

    //cacheFiles, 快取夾內除主幹清單副本(紀錄用)外之檔案
    let cacheFiles = (fd) => listFiles(fd).filter((v) => path.basename(v) !== 'manifest-last.json')

    before(async function () {
        real = JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))
        rk = real.files[0]
        zipName = rk.url.split('/').pop()
        tagA = /\/download\/(v\d+\.\d+\.\d+)\//.exec(rk.url)[1]
        memberA = rk.extract.member
        urlA = rk.url
        urlB = rk.url.replace(`/${tagA}/`, `/${tagB}/`).replace(`k6-${tagA}-`, `k6-${tagB}-`)

        fs.rmSync(FDT, { recursive: true, force: true })
        fs.mkdirSync(FDT, { recursive: true })
        const mk = (tag, text) => {
            const exe = Buffer.from(`MZ-fake-k6-${tag}-${text}`.padEnd(2000, '.'))
            const member = `k6-${tag}-windows-amd64/k6.exe`
            const zip = makeZip(path.join(FDT, `zip-${tag}`), { [member]: exe, [`k6-${tag}-windows-amd64/README.md`]: 'readme' })
            return { exe, member, zip }
        }
        const a = mk(tagA, 'A')
        exeA = a.exe
        zipA = a.zip
        assert.strictEqual(a.member, memberA) //合成之成員路徑與真清單相同
        const b = mk(tagB, 'B')
        exeB = b.exe
        zipB = b.zip
        hashExeA = hashBuf(exeA)
        hashZipA = hashBuf(zipA)
        hashExeB = hashBuf(exeB)
        const synth = (tag, url, member, zip, exe) => {
            const m = JSON.parse(JSON.stringify(real))
            m.files[0] = { ...m.files[0], url, ...hashBuf(zip), extract: { ...m.files[0].extract, member, ...hashBuf(exe) } }
            assert.strictEqual(m.files[0].name, 'k6.exe')
            return m
        }
        synthA = synth(tagA, urlA, memberA, zipA, exeA)
        synthB = synth(tagB, urlB, b.member, zipB, exeB)

        server = http.createServer((req, res) => {
            hits.push(req.url)
            if (req.url === '/yuda-lyu/w-scan-stress/master/bin/manifest.json') {
                const t = mode.trunk || 'same'
                if (t === '500') {
                    res.writeHead(500)
                    res.end()
                    return
                }
                const body = t === 'invalid' ? '{ not json' : JSON.stringify(t === 'newer' ? synthB : t === 'wrongpkg' ? { ...synthB, pkg: 'w-other', repo: 'yuda-lyu/w-other' } : synthA)
                res.writeHead(200, { 'content-length': String(Buffer.byteLength(body)) })
                res.end(body)
                return
            }
            const m = /^\/grafana\/k6\/releases\/download\/(v[\d.]+)\/(.+)$/.exec(req.url)
            const z = m === null ? null : (m[1] === tagA ? zipA : m[1] === tagB ? zipB : null)
            if (z === null || (mode.zip || 'good') === 'missing') {
                res.writeHead(404)
                res.end()
                return
            }
            let body = z
            if (mode.zip === 'flip') body = flip(z, 40)
            if (mode.zip === 'short') body = z.subarray(0, z.length - 1)
            res.writeHead(200, { 'content-length': String(body.length) })
            res.end(body)
        })
        await new Promise((resolve, reject) => {
            server.once('error', reject)
            server.listen(PORT, '127.0.0.1', resolve)
        })
    })

    after(async function () {
        await new Promise((resolve) => server.close(resolve))
        fs.rmSync(FDT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        assert.ok(!fs.existsSync(FDT))
    })

    beforeEach(function () {
        hits = []
        urls = []
        banned = []
        mode = {}
    })

    afterEach(function () {
        for (const fd of temps) fs.rmSync(fd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        temps = []
    })

    it('合成清單與真清單同形(網址、鍵名、成員路徑皆沿用, 僅校驗值不同)', function () {
        //規則: 下載路徑之驗證以與真清單同形之合成清單為準, 故二者除 sha256、size 外須相同
        assert.deepStrictEqual(Object.keys(synthA.files[0]), Object.keys(rk))
        assert.strictEqual(synthA.files[0].url, rk.url)
        assert.strictEqual(synthA.files[0].extract.member, rk.extract.member)
        assert.strictEqual(synthA.mode, 'floating')
        assert.notStrictEqual(synthA.files[0].sha256, rk.sha256)
    })

    it('T3: 首次自版本標籤網址下載 zip → 解出 k6.exe → 校驗 → 只快取最終檔; 再次呼叫不重新下載, 離線時不連網', async function () {
        const { ensureBins } = await mkRoot(synthA)
        const cacheDir = newDir('cache')

        const r1 = await ensureBins({ cacheDir, fetch, mirror: '', offline: false })
        //規則(D3): 快取位置 <快取>/<sha256>/<name>, sha256 為解出之最終檔
        assert.deepStrictEqual(Object.keys(r1), ['k6.exe'])
        assert.strictEqual(r1['k6.exe'], path.join(cacheDir, hashExeA.sha256, 'k6.exe'))
        assert.deepStrictEqual(hashFile(r1['k6.exe']), hashExeA)
        //規則(M5): 主幹模式先取主幹清單(master), 再自清單之版本標籤資產網址下載; 不得為 releases/latest
        assert.deepStrictEqual(urls, [URL_TRUNK, urlA])
        assert.ok(!urls.some((v) => v.includes('/latest')))
        //規則(F3): 快取只存最終檔, 不留 zip、暫存夾
        assert.deepStrictEqual(cacheFiles(cacheDir), [r1['k6.exe']])
        assert.strictEqual(hits.filter((v) => v.startsWith('/grafana/')).length, 1)

        //規則(D4): 第二次命中快取(亦校驗), 不再下載 zip; 主幹清單取不到時用基準清單
        const r2 = await ensureBins({ cacheDir, fetch: fetchBan, mirror: '', offline: false })
        assert.strictEqual(r2['k6.exe'], r1['k6.exe'])
        assert.deepStrictEqual(banned, [URL_TRUNK])
        assert.strictEqual(hits.filter((v) => v.startsWith('/grafana/')).length, 1)

        //規則(O3): 離線時不連任何網路(含主幹清單)
        banned = []
        const r3 = await ensureBins({ cacheDir, fetch: fetchBan, mirror: '', offline: true })
        assert.strictEqual(r3['k6.exe'], r1['k6.exe'])
        assert.deepStrictEqual(banned, [])
    })

    it('T4: zip 之雜湊不符、大小不符、HTTP 錯誤: 拒用且快取不留檔', async function () {
        const { ensureBins } = await mkRoot(synthA)
        for (const [m, code] of [['flip', 'E_HASH_MISMATCH'], ['short', 'E_SIZE_MISMATCH'], ['missing', 'E_HTTP']]) {
            mode = { zip: m }
            const cacheDir = newDir('cache')
            const err = await catchErr(() => ensureBins({ cacheDir, fetch, mirror: '', offline: false, maxAttempts: 1 }))
            //規則(M2、D2): 以清單之 sha256 與大小校驗下載, 不符即拒用
            assert.strictEqual(err && err.code, code, `${m}: ${err && err.message}`)
            assert.deepStrictEqual(cacheFiles(cacheDir), [], m)
        }
    })

    it('T4: 解出之 k6.exe 與清單之 extract 不符: 拒用且快取不留檔', async function () {
        //zip 本身之校驗值相符, 但其內 k6.exe 之校驗值與清單不同
        const m = JSON.parse(JSON.stringify(synthA))
        m.files[0].extract = { ...m.files[0].extract, ...hashBuf(Buffer.from('another k6')) }
        mode = { trunk: '500' } //主幹清單取不到, 使用此基準清單(否則主幹清單 synthA 會取代之)
        const { ensureBins } = await mkRoot(m)
        const cacheDir = newDir('cache')
        const err = await catchErr(() => ensureBins({ cacheDir, fetch, mirror: '', offline: false, maxAttempts: 1 }))
        assert.ok(err && ['E_HASH_MISMATCH', 'E_SIZE_MISMATCH'].includes(err.code), err && err.message)
        assert.deepStrictEqual(cacheFiles(cacheDir), [])
    })

    it('T5: W_BIN_MIRROR(本地資料夾)放最終檔: 離線自鏡像取得, 不連網', async function () {
        const { ensureBins } = await mkRoot(synthA)
        const mirror = newDir('mirror')
        seedMirror(mirror, hashExeA.sha256, 'k6.exe', exeA)
        const cacheDir = newDir('cache')
        const r = await ensureBins({ cacheDir, fetch: fetchBan, mirror, offline: true })
        assert.strictEqual(r['k6.exe'], path.join(cacheDir, hashExeA.sha256, 'k6.exe'))
        assert.deepStrictEqual(hashFile(r['k6.exe']), hashExeA)
        assert.deepStrictEqual(banned, [])
    })

    it('T5: 鏡像放 zip(<sha256>/<zip 檔名>): 離線解出並校驗', async function () {
        const { ensureBins } = await mkRoot(synthA)
        const mirror = newDir('mirror')
        seedMirror(mirror, hashZipA.sha256, zipName, zipA)
        const cacheDir = newDir('cache')
        const r = await ensureBins({ cacheDir, fetch: fetchBan, mirror, offline: true })
        assert.deepStrictEqual(hashFile(r['k6.exe']), hashExeA)
        assert.deepStrictEqual(cacheFiles(cacheDir), [r['k6.exe']])
        assert.deepStrictEqual(banned, [])
    })

    it('T5: 鏡像之檔被竄改(同長度): 離線拒用(E_OFFLINE_MISSING)且不進快取; 可連網時改自 GitHub 取得且鏡像不被改動', async function () {
        const { ensureBins } = await mkRoot(synthA)
        const mirror = newDir('mirror')
        seedMirror(mirror, hashExeA.sha256, 'k6.exe', flip(exeA))
        seedMirror(mirror, hashZipA.sha256, zipName, flip(zipA, 40))
        const cacheDir = newDir('cache')
        const err = await catchErr(() => ensureBins({ cacheDir, fetch: fetchBan, mirror, offline: true }))
        assert.strictEqual(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        assert.deepStrictEqual(cacheFiles(cacheDir), [])

        const cacheDir2 = newDir('cache')
        const r = await ensureBins({ cacheDir: cacheDir2, fetch, mirror, offline: false })
        assert.deepStrictEqual(hashFile(r['k6.exe']), hashExeA)
        assert.ok(urls.includes(urlA))
        assert.ok(fs.readFileSync(path.join(mirror, 'w-scan-stress', hashExeA.sha256, 'k6.exe')).equals(flip(exeA)))
    })

    it('T6: 離線且無快取無鏡像: E_OFFLINE_MISSING, 訊息含檔名、sha256、大小與應放路徑, 不連網', async function () {
        const { ensureBins } = await mkRoot(synthA)
        const cacheDir = newDir('cache')
        const err = await catchErr(() => ensureBins({ cacheDir, fetch: fetchBan, mirror: '', offline: true }))
        assert.strictEqual(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        const cachePath = path.join(cacheDir, hashExeA.sha256, 'k6.exe')
        //規則(O3): 訊息須寫明缺哪個檔(名稱、sha256、大小)、應放到哪(快取或鏡像之完整路徑)
        assert.ok(err.message.includes('k6.exe'), err.message)
        assert.ok(err.message.includes(hashExeA.sha256), err.message)
        assert.ok(err.message.includes(`${hashExeA.size} bytes`), err.message)
        assert.ok(err.message.includes(cachePath), err.message)
        assert.ok(err.message.includes(`<W_BIN_MIRROR>/w-scan-stress/${hashExeA.sha256}/k6.exe`), err.message)
        assert.deepStrictEqual(err.missing.map((v) => [v.name, v.sha256, v.size, v.cachePath]), [['k6.exe', hashExeA.sha256, hashExeA.size, cachePath]])
        assert.deepStrictEqual(banned, [])
        assert.deepStrictEqual(cacheFiles(cacheDir), [])
    })

    it('T6: 真清單(bin/manifest.json)經 src/ensureBins.mjs 離線缺檔時, 訊息列出真清單之 k6.exe、解出檔之 sha256 與大小', async function () {
        //規則: 真清單須通過 fsEnsureBins 之 schema 檢核(否則為 E_MANIFEST); 缺檔訊息以真清單之值為準
        const cacheDir = newDir('cache')
        const err = await catchErr(() => ensureBinsReal({ cacheDir, fetch: fetchBan, mirror: '', offline: true }))
        assert.strictEqual(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        assert.ok(err.message.includes('k6.exe') && err.message.includes(rk.extract.sha256) && err.message.includes(`${rk.extract.size} bytes`), err.message)
        assert.ok(err.message.includes(path.join(cacheDir, rk.extract.sha256, 'k6.exe')), err.message)
        assert.deepStrictEqual(banned, [])
    })

    it('T7: 快取之 k6.exe 被竄改(同長度)或截短: 重新取得', async function () {
        const { ensureBins } = await mkRoot(synthA)
        const mirror = newDir('mirror')
        seedMirror(mirror, hashExeA.sha256, 'k6.exe', exeA)
        const cacheDir = newDir('cache')
        const r1 = await ensureBins({ cacheDir, fetch: fetchBan, mirror, offline: true })

        fs.writeFileSync(r1['k6.exe'], flip(exeA, 100))
        assert.notStrictEqual(hashFile(r1['k6.exe']).sha256, hashExeA.sha256)
        const r2 = await ensureBins({ cacheDir, fetch: fetchBan, mirror, offline: true })
        assert.strictEqual(r2['k6.exe'], r1['k6.exe'])
        assert.deepStrictEqual(hashFile(r2['k6.exe']), hashExeA)

        //截短(大小不符)且鏡像無檔: 自 GitHub 重新下載
        fs.rmSync(mirror, { recursive: true, force: true })
        fs.truncateSync(r2['k6.exe'], 100)
        const r3 = await ensureBins({ cacheDir, fetch, mirror: '', offline: false })
        assert.deepStrictEqual(hashFile(r3['k6.exe']), hashExeA)
        assert.ok(urls.includes(urlA))
    })

    it('T8: 主幹清單取得失敗(HTTP 500、非 JSON、他套件之清單): 用包內基準清單', async function () {
        const { ensureBins } = await mkRoot(synthA)
        for (const t of ['500', 'invalid', 'wrongpkg']) {
            mode = { trunk: t }
            urls = []
            const cacheDir = newDir('cache')
            const r = await ensureBins({ cacheDir, fetch, mirror: '', offline: false, maxAttempts: 1 })
            //規則(M5): 取不到或通不過 schema 檢查之主幹清單, 退回基準清單(版本 A)
            assert.strictEqual(r['k6.exe'], path.join(cacheDir, hashExeA.sha256, 'k6.exe'), t)
            assert.deepStrictEqual(hashFile(r['k6.exe']), hashExeA, t)
            assert.deepStrictEqual(urls, [URL_TRUNK, urlA], t)
        }
    })

    it('T8: 主幹清單為較新版本: 取得該版(自其版本標籤網址下載), 基準清單之版本不被取得', async function () {
        mode = { trunk: 'newer' }
        const { ensureBins } = await mkRoot(synthA)
        const cacheDir = newDir('cache')
        const r = await ensureBins({ cacheDir, fetch, mirror: '', offline: false, maxAttempts: 1 })
        //規則(M5、U2): 更新執行檔只須推 GitHub 主幹, 執行時即取最新清單
        assert.strictEqual(r['k6.exe'], path.join(cacheDir, hashExeB.sha256, 'k6.exe'))
        assert.deepStrictEqual(hashFile(r['k6.exe']), hashExeB)
        assert.deepStrictEqual(urls, [URL_TRUNK, urlB])
        assert.ok(!urls.includes(urlA))
    })

    it('E2: 不轉傳 floatingManifestUrl(會改變清單之信任錨): 無效或他處之值皆不影響, 仍取 master 之主幹清單', async function () {
        const { ensureBins } = await mkRoot(synthA)
        for (const v of ['not-a-valid-url', `${RAW}/yuda-lyu/w-scan-stress/other/bin/manifest.json`, 'http://evil.invalid/manifest.json']) {
            urls = []
            const cacheDir = newDir('cache')
            const r = await ensureBins({ cacheDir, fetch, mirror: '', offline: false, maxAttempts: 1, floatingManifestUrl: v })
            assert.deepStrictEqual(hashFile(r['k6.exe']), hashExeA, v)
            assert.strictEqual(urls[0], URL_TRUNK, v)
            assert.ok(!urls.includes(v), v)
        }
    })

    it('D3: 預設快取位於套件根之 bin-cache/, 與載入時之工作目錄無關', function () {
        //套件根於模組載入時決定, 故以子行程於他處工作目錄載入(被安裝為相依套件時, 載入時之工作目錄為使用者專案而非套件根);
        //為不在本套件根建立 bin-cache/, 於暫存夾組假套件根(src/ensureBins.mjs 之副本＋清單)
        const root = newDir('rootcwd')
        fs.mkdirSync(path.join(root, 'src'), { recursive: true })
        fs.mkdirSync(path.join(root, 'bin'), { recursive: true })
        fs.copyFileSync('src/ensureBins.mjs', path.join(root, 'src', 'ensureBins.mjs'))
        fs.writeFileSync(path.join(root, 'bin', 'manifest.json'), JSON.stringify(synthA))
        const env = { ...process.env }
        for (const k of ['W_BIN_CACHE', 'W_BIN_MIRROR', 'W_BIN_OFFLINE']) delete env[k]
        const cwdOther = os.tmpdir()
        const r = spawnSync(process.execPath, [path.resolve('test/tools/ensureBinsChild.mjs'), path.join(root, 'src', 'ensureBins.mjs')], { cwd: cwdOther, env, encoding: 'utf8', windowsHide: true })
        assert.strictEqual(r.status, 0, r.stderr)
        const o = JSON.parse(r.stdout.trim().split('\n').pop())
        assert.strictEqual(path.resolve(o.cwd), path.resolve(cwdOther)) //確實於他處載入
        assert.strictEqual(o.code, 'E_OFFLINE_MISSING')
        assert.strictEqual(o.cachePath, path.join(root, 'bin-cache', hashExeA.sha256, 'k6.exe')) //缺檔之應放路徑在(假)套件根下之預設快取
    })

    it('D3、O1、O3: 環境變數 W_BIN_CACHE、W_BIN_MIRROR、W_BIN_OFFLINE', async function () {
        const { ensureBins } = await mkRoot(synthA)
        const mirror = newDir('mirror')
        seedMirror(mirror, hashExeA.sha256, 'k6.exe', exeA)
        const envRoot = newDir('envroot')
        const r = await withEnv({ W_BIN_CACHE: envRoot, W_BIN_MIRROR: mirror, W_BIN_OFFLINE: '1' }, () => ensureBins({ fetch: fetchBan }))
        //規則(D3): 共用快取為 <W_BIN_CACHE>/<套件>/<sha256>/<name>
        assert.strictEqual(r['k6.exe'], path.join(envRoot, 'w-scan-stress', hashExeA.sha256, 'k6.exe'))
        assert.deepStrictEqual(banned, [])

        //規則(O4): 設 W_BIN_CACHE 取得所得之資料夾即為鏡像(結構相同), 可再作為 W_BIN_MIRROR
        const cacheDir = newDir('cache')
        const r2 = await ensureBins({ cacheDir, fetch: fetchBan, mirror: envRoot, offline: true })
        assert.deepStrictEqual(hashFile(r2['k6.exe']), hashExeA)

        //規則(O3): W_BIN_OFFLINE=1 且無快取無鏡像 → E_OFFLINE_MISSING
        const envRoot2 = newDir('envroot')
        const err = await withEnv({ W_BIN_CACHE: envRoot2, W_BIN_MIRROR: undefined, W_BIN_OFFLINE: '1' }, () => catchErr(() => ensureBins({ fetch: fetchBan })))
        assert.strictEqual(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        assert.ok(err.message.includes(path.join(envRoot2, 'w-scan-stress', hashExeA.sha256, 'k6.exe')), err.message)
    })

})


//主函數 WScanStress 無法注入 fetch: 攔截全域 fetch(被呼叫即記錄並拋錯, 斷言未被呼叫: 否則回歸為直連時測試仍會因真網路而綠),
//並攔截 child_process.spawn/spawnSync(對 k6.exe 回傳假結果, 其餘照常), 斷言所啟動者為 ensureBins 回傳之路徑
//(舊路徑檔與快取檔位元相同時, 只驗功能輸出之測試對「先取得卻仍用舊路徑」盲)
describe('WScanStress: 以 ensureBins 取得 k6.exe(整個 src/ 之副本＋合成清單)', function () {
    this.timeout(120000)

    let fdt = path.join(FDT, 'main')
    let cp = createRequire(import.meta.url)('node:child_process')
    let orig = { spawn: cp.spawn, spawnSync: cp.spawnSync }
    let fetchBak = null
    let netCalls = []
    let calls = { spawnSync: [], spawn: [] }
    let exe = null
    let hashExe = null
    let wss = null
    let mirror = ''

    let isK6 = (cmd) => path.basename(String(cmd)).toLowerCase() === 'k6.exe'
    let fakeChild = () => {
        const ch = new EventEmitter()
        ch.stdout = new PassThrough()
        ch.stderr = new PassThrough()
        ch.kill = () => {}
        setImmediate(() => {
            ch.stdout.end()
            ch.stderr.end()
            ch.emit('close', 0)
        })
        return ch
    }

    before(async function () {
        fs.rmSync(fdt, { recursive: true, force: true })
        const real = JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))
        exe = Buffer.from('MZ-fake-k6-main'.padEnd(1500, '.'))
        const member = real.files[0].extract.member
        const zip = makeZip(path.join(fdt, 'zip'), { [member]: exe })
        const m = JSON.parse(JSON.stringify(real))
        m.files[0] = { ...m.files[0], ...hashBuf(zip), extract: { ...m.files[0].extract, ...hashBuf(exe) } }
        hashExe = hashBuf(exe)

        //整個 src/ 之副本(WScanStress.mjs 與其相對匯入之模組、k6Scenario.js)＋合成清單; 缺 src/ensureBins.mjs 時此處即失敗
        const root = path.join(fdt, 'root')
        fs.mkdirSync(path.join(root, 'src'), { recursive: true })
        fs.mkdirSync(path.join(root, 'bin'), { recursive: true })
        for (const f of fs.readdirSync('src')) {
            if (/\.(mjs|js)$/.test(f)) fs.copyFileSync(path.join('src', f), path.join(root, 'src', f))
        }
        fs.copyFileSync(path.join('src', 'ensureBins.mjs'), path.join(root, 'src', 'ensureBins.mjs'))
        fs.writeFileSync(path.join(root, 'bin', 'manifest.json'), JSON.stringify(m))
        mirror = path.join(fdt, 'mirror')
        fs.mkdirSync(path.join(mirror, 'w-scan-stress', hashExe.sha256), { recursive: true })
        fs.writeFileSync(path.join(mirror, 'w-scan-stress', hashExe.sha256, 'k6.exe'), exe)
        wss = (await import(pathToFileURL(path.join(root, 'src', 'WScanStress.mjs')).href)).default

        fetchBak = globalThis.fetch
        globalThis.fetch = (url) => {
            netCalls.push(String(url))
            throw new Error(`network access is forbidden in tests: ${url}`)
        }
        cp.spawnSync = (cmd, args, o) => {
            calls.spawnSync.push({ cmd: String(cmd), args })
            if (isK6(cmd)) return { status: 0, stdout: 'k6 v0.0.0 (fake)\n', stderr: '', error: undefined }
            return orig.spawnSync(cmd, args, o)
        }
        cp.spawn = (cmd, args, o) => {
            calls.spawn.push({ cmd: String(cmd), args })
            if (isK6(cmd)) return fakeChild()
            return orig.spawn(cmd, args, o)
        }
        syncBuiltinESMExports()
    })

    after(function () {
        globalThis.fetch = fetchBak
        cp.spawn = orig.spawn
        cp.spawnSync = orig.spawnSync
        syncBuiltinESMExports()
        fs.rmSync(FDT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        assert.ok(!fs.existsSync(FDT))
    })

    beforeEach(function () {
        netCalls = []
        calls = { spawnSync: [], spawn: [] }
    })

    let run = (extra, env) => {
        const fdOut = path.join(fdt, 'out')
        return withEnv({ W_BIN_CACHE: undefined, W_BIN_MIRROR: undefined, W_BIN_OFFLINE: undefined, ...env }, () => wss(fdOut, { scenario: { phases: [{ kind: 'sleep', sec: 1 }] }, mode: 'smoke', quiet: true, ...extra }))
    }

    it('未給 k6Path: 經 ensureBins 自鏡像取得 k6.exe, 所啟動者(k6 version 與 k6 run)為其回傳之快取路徑; 全域 fetch 未被呼叫', async function () {
        const cacheRoot = path.join(fdt, 'cache-a')
        const r = await run({}, { W_BIN_CACHE: cacheRoot, W_BIN_MIRROR: mirror, W_BIN_OFFLINE: '1' })
        const fpExe = path.join(cacheRoot, 'w-scan-stress', hashExe.sha256, 'k6.exe')
        //規則(D1、E2): k6.exe 經 ensureBins 取得(快取 → 鏡像 → GitHub), 校驗後存於快取夾
        assert.deepStrictEqual(hashFile(fpExe), hashExe)
        //規則: 啟動者須為 ensureBins 回傳之路徑(非 src/、非舊的工具資料夾)
        assert.deepStrictEqual(calls.spawnSync.filter((v) => isK6(v.cmd)).map((v) => [v.cmd, v.args]), [[fpExe, ['version']]])
        assert.deepStrictEqual(calls.spawn.filter((v) => isK6(v.cmd)).map((v) => [v.cmd, v.args[0]]), [[fpExe, 'run']])
        //規則(§8 T3): 取得時不連網
        assert.deepStrictEqual(netCalls, [])
        assert.strictEqual(r.levels.length, 1)
        //規則: 不在結果資料夾下建立舊的工具資料夾(fdOut/tools)
        assert.ok(!fs.existsSync(path.join(fdt, 'out', 'tools')))
    })

    it('對照案: 給 k6Path 時啟動者為 k6Path(證明上案之攔截有效), 且不呼叫 ensureBins(快取夾未建立)', async function () {
        const fpK6 = path.join(fdt, 'own', 'k6.exe')
        fs.mkdirSync(path.dirname(fpK6), { recursive: true })
        fs.writeFileSync(fpK6, 'own')
        const cacheRoot = path.join(fdt, 'cache-b')
        await run({ k6Path: fpK6 }, { W_BIN_CACHE: cacheRoot, W_BIN_MIRROR: mirror, W_BIN_OFFLINE: '1' })
        assert.deepStrictEqual(calls.spawnSync.filter((v) => isK6(v.cmd)).map((v) => v.cmd), [fpK6])
        assert.deepStrictEqual(calls.spawn.filter((v) => isK6(v.cmd)).map((v) => v.cmd), [fpK6])
        assert.ok(!fs.existsSync(cacheRoot))
        assert.deepStrictEqual(netCalls, [])
    })

    it('opt.offline: true 且鏡像有檔(環境變數未設離線): 不連網', async function () {
        const cacheRoot = path.join(fdt, 'cache-c')
        await run({ offline: true }, { W_BIN_CACHE: cacheRoot, W_BIN_MIRROR: mirror })
        const fpExe = path.join(cacheRoot, 'w-scan-stress', hashExe.sha256, 'k6.exe')
        assert.deepStrictEqual(calls.spawn.filter((v) => isK6(v.cmd)).map((v) => v.cmd), [fpExe])
        assert.deepStrictEqual(netCalls, [])
    })

    it('取不到 k6.exe(離線、無快取、無鏡像): 於取 session 與建立結果資料夾之前以 E_OFFLINE_MISSING 拒絕, 未啟動 k6', async function () {
        let called = false
        const cacheRoot = path.join(fdt, 'cache-d')
        const fdOut = path.join(fdt, 'out-d')
        const err = await catchErr(() => withEnv({ W_BIN_CACHE: cacheRoot, W_BIN_MIRROR: undefined, W_BIN_OFFLINE: '1' }, () => wss(fdOut, {
            scenario: { phases: [{ kind: 'sleep', sec: 1 }] },
            mode: 'smoke',
            quiet: true,
            getSessions: async () => {
                called = true
                return [{}]
            },
        })))
        assert.strictEqual(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        assert.ok(err.message.includes(hashExe.sha256), err.message)
        assert.strictEqual(called, false)
        assert.ok(!fs.existsSync(fdOut))
        assert.deepStrictEqual(calls.spawn.filter((v) => isK6(v.cmd)), [])
        assert.deepStrictEqual(netCalls, [])
    })

    it('已移除之選項 fdTools 明確拒絕(不留相容層、不默默忽略): 不取得 k6、不啟動任何程式、不建立任何夾', async function () {
        const cacheRoot = path.join(fdt, 'cache-e')
        const fdTools = path.join(fdt, 'legacy-tools')
        await assert.rejects(run({ fdTools }, { W_BIN_CACHE: cacheRoot, W_BIN_MIRROR: mirror, W_BIN_OFFLINE: '1' }), /opt\.fdTools 已移除.*W_BIN_CACHE/)
        assert.ok(!fs.existsSync(fdTools))
        assert.ok(!fs.existsSync(cacheRoot))
        assert.deepStrictEqual(calls.spawnSync.filter((v) => isK6(v.cmd)), [])
        assert.deepStrictEqual(calls.spawn.filter((v) => isK6(v.cmd)), [])
    })

    it('主檔只有 default 匯出(具名匯出會改變 UMD 之 require 形態), ensureBins 為其靜態屬性且即 src/ensureBins.mjs 之預設匯出', function () {
        assert.deepStrictEqual(Object.keys(nsMain), ['default'])
        assert.strictEqual(typeof WScanStressReal.ensureBins, 'function')
        assert.strictEqual(WScanStressReal.ensureBins, ensureBinsReal)
    })

})
