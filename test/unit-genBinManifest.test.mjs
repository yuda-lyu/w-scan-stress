//
// unit: 清單產生與更新工具(toolg/genBinManifest.mjs), 以本機 HTTP 伺服器扮 api.github.com 與 github.com(不連外網)
//
// 對應規格: 外部執行檔之存放下載校驗與離線(制式規格, C:\opensrcOper\dspec) M1~M3、S3、U2、U3
//   查廠商最新版 → 下載 zip 與 checksums → 核對(checksums、API digest、大小) → 解出 k6.exe 自算校驗值 → 產生清單(版本標籤之資產網址, 不得 releases/latest);
//   核對不符、資產缺漏、zip 內 k6.exe 不唯一、預發布版皆拒絕且不產生清單
//
import { strict as assert } from 'assert'
import fs from 'fs'
import path from 'path'
import http from 'http'
import crypto from 'crypto'
import { spawnSync } from 'child_process'
import fsEnsureBins from 'wsemi/src/fsEnsureBins.mjs'
import { genBinManifest, parseChecksums } from '../toolg/genBinManifest.mjs'
import { makeZip, hashBuf } from './tools/binFixtures.mjs'


const API = 'https://api.github.com'
const GH = 'https://github.com'
const PORT = 8095
const TAG = 'v1.2.3'
const fdt = path.resolve('./test/_tmp/genBinManifest')
const fdWork = path.join(fdt, 'work')


describe('genBinManifest: 清單產生與更新工具', function () {
    this.timeout(120000)

    let exe = null
    let zip = null
    let hExe = null
    let hZip = null
    let server = null
    let hits = []
    let urls = []
    //rel: 伺服器行為與內容, 每案重置
    let rel = null

    let fetch = (url, init) => {
        const u = String(url)
        urls.push(u)
        if (u.startsWith(`${API}/`)) return globalThis.fetch(u.replace(API, `http://127.0.0.1:${PORT}`), init)
        if (u.startsWith(`${GH}/`)) return globalThis.fetch(u.replace(GH, `http://127.0.0.1:${PORT}`), init)
        throw new Error(`unexpected url[${u}]`)
    }

    let sums = (sha, name = `k6-${TAG}-windows-amd64.zip`) => `${'0'.repeat(63)}1  k6-${TAG}-windows-amd64.msi\n${sha}  ${name}\n`
    let resetRel = () => {
        rel = {
            api: {
                tag_name: TAG,
                draft: false,
                prerelease: false,
                assets: [
                    { name: `k6-${TAG}-windows-amd64.zip`, size: hZip.size, digest: `sha256:${hZip.sha256}` },
                    { name: `k6-${TAG}-checksums.txt`, size: 100 },
                    { name: `k6-${TAG}-linux-amd64.tar.gz`, size: 10 },
                ],
            },
            sums: sums(hZip.sha256),
            zip,
        }
    }

    before(async function () {
        fs.rmSync(fdt, { recursive: true, force: true })
        fs.mkdirSync(fdt, { recursive: true })
        exe = Buffer.from('MZ-fake-k6-gen'.padEnd(3000, '.'))
        zip = makeZip(path.join(fdt, 'zip'), { [`k6-${TAG}-windows-amd64/k6.exe`]: exe, [`k6-${TAG}-windows-amd64/README.md`]: 'readme' })
        hExe = hashBuf(exe)
        hZip = hashBuf(zip)
        server = http.createServer((req, res) => {
            hits.push(req.url)
            const send = (code, body, type = 'application/octet-stream') => {
                res.writeHead(code, { 'content-type': type, 'content-length': String(Buffer.byteLength(body)) })
                res.end(body)
            }
            if (req.url === '/repos/grafana/k6/releases/latest' || req.url === `/repos/grafana/k6/releases/tags/${TAG}`) {
                return send(200, JSON.stringify(rel.api), 'application/json')
            }
            if (req.url === `/grafana/k6/releases/download/${TAG}/k6-${TAG}-checksums.txt`) return send(200, rel.sums, 'text/plain')
            if (req.url === `/grafana/k6/releases/download/${TAG}/k6-${TAG}-windows-amd64.zip`) return send(200, rel.zip)
            send(404, '')
        })
        await new Promise((resolve, reject) => {
            server.once('error', reject)
            server.listen(PORT, '127.0.0.1', resolve)
        })
    })

    after(async function () {
        await new Promise((resolve) => server.close(resolve))
        fs.rmSync(fdt, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        assert.ok(!fs.existsSync(fdt))
    })

    beforeEach(function () {
        hits = []
        urls = []
        resetRel()
    })

    let gen = (o = {}) => genBinManifest({ pkgName: 'w-scan-stress', fdWork, fetch, date: '2026-01-02', ...o })

    it('parseChecksums: 解析 `<sha256>  <檔名>`(含二進位標記 * 與 CRLF), 同名而雜湊不同者拋錯', function () {
        const a = 'a'.repeat(64)
        const b = 'B'.repeat(64)
        const m = parseChecksums(`${a}  x.zip\r\n${b} *y.zip\r\nnot a line\r\n`)
        //規則: 以資產檔名為鍵、小寫 sha256 為值, 非校驗行略過
        assert.deepEqual([...m.entries()], [['x.zip', a], ['y.zip', 'b'.repeat(64)]])
        assert.throws(() => parseChecksums(`${a}  x.zip\n${'c'.repeat(64)}  x.zip\n`), /twice/)
    })

    it('查最新版: 產生版本標籤資產網址之清單, zip 之校驗值取自 checksums、解出之 k6.exe 為自算值, 通過 fsEnsureBins 之 schema 檢核', async function () {
        const r = await gen()
        assert.equal(r.tag, TAG)
        const m = r.manifest
        const urlZip = `${GH}/grafana/k6/releases/download/${TAG}/k6-${TAG}-windows-amd64.zip`
        //規則(M1、S3、M2): 主幹模式, 廠商檔以版本標籤之資產網址為來源, 不得 releases/latest
        assert.deepEqual({ ...m, files: undefined }, { schema: 1, pkg: 'w-scan-stress', mode: 'floating', repo: 'yuda-lyu/w-scan-stress', manifestPath: 'bin/manifest.json', files: undefined })
        assert.equal(m.files.length, 1)
        const f = m.files[0]
        assert.equal(f.name, 'k6.exe')
        assert.equal(f.url, urlZip)
        assert.ok(!JSON.stringify(m).includes('/latest/'))
        //規則(M3): zip 之 sha256 取自廠商公告之 checksums, 大小取自 API
        assert.equal(f.sha256, hZip.sha256)
        assert.equal(f.size, hZip.size)
        //規則(M1): 解出之成員與其自算之校驗值(zip 內另有 README.md, 只取 k6.exe)
        assert.deepEqual(f.extract, { type: 'zip', member: `k6-${TAG}-windows-amd64/k6.exe`, sha256: hExe.sha256, size: hExe.size })
        //規則(M3): note 載明核對依據與日期
        assert.ok(f.note.includes(`k6-${TAG}-checksums.txt`) && f.note.includes('2026-01-02') && f.note.includes('digest'), f.note)
        //規則: 查最新版走 releases/latest 之 API, 但清單內網址不是
        assert.ok(urls[0].endsWith('/repos/grafana/k6/releases/latest'))
        //規則: 產生之清單須通過 fsEnsureBins 之 schema 檢核
        const err = await fsEnsureBins(m, { pkgRoot: fdt, cacheDir: path.join(fdt, 'cache'), mirror: '', offline: true }).then(() => null, (e) => e)
        assert.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        //規則: 暫存夾結束即刪
        assert.ok(!fs.existsSync(fdWork))
    })

    it('指定版本: 查該標籤之 release, 不查最新版', async function () {
        const r = await gen({ tag: TAG })
        assert.equal(r.tag, TAG)
        assert.ok(urls[0].endsWith(`/repos/grafana/k6/releases/tags/${TAG}`))
        assert.ok(!urls.some((v) => v.endsWith('/releases/latest')))
    })

    it('API 不附 digest 時仍以 checksums 為準, note 不稱與 digest 一致', async function () {
        delete rel.api.assets[0].digest
        const r = await gen()
        assert.equal(r.manifest.files[0].sha256, hZip.sha256)
        assert.ok(!r.manifest.files[0].note.includes('digest'))
    })

    it('核對不符一律拒絕且不留暫存夾', async function () {
        //規則(M3): checksums 所列之雜湊與下載之 zip 不符 → 下載校驗失敗
        rel.sums = sums('d'.repeat(64))
        rel.api.assets[0].digest = `sha256:${'d'.repeat(64)}`
        await assert.rejects(gen(), (err) => err && (err.code === 'E_HASH_MISMATCH' || /sha256/.test(err.message)))
        assert.ok(!fs.existsSync(fdWork))

        //規則: API 之 digest 與 checksums 不一致
        resetRel()
        rel.api.assets[0].digest = `sha256:${'e'.repeat(64)}`
        await assert.rejects(gen(), /digest/)

        //規則: API 之 size 與實際不符
        resetRel()
        rel.api.assets[0].size = hZip.size + 1
        await assert.rejects(gen(), (err) => err && (err.code === 'E_SIZE_MISMATCH' || /size/i.test(err.message)))

        //規則: checksums 未列該 zip
        resetRel()
        rel.sums = sums(hZip.sha256, 'other.zip')
        await assert.rejects(gen(), /does not list/)
        assert.ok(!fs.existsSync(fdWork))
    })

    it('資產缺漏、預發布版、版本標籤格式有誤、zip 內 k6.exe 不唯一: 拒絕', async function () {
        rel.api.assets = rel.api.assets.filter((v) => !v.name.endsWith('.zip'))
        await assert.rejects(gen(), /lacks the asset/)

        resetRel()
        rel.api.assets = rel.api.assets.filter((v) => !v.name.endsWith('checksums.txt'))
        await assert.rejects(gen(), /lacks the asset/)

        resetRel()
        rel.api.prerelease = true
        await assert.rejects(gen(), /prerelease/)

        resetRel()
        await assert.rejects(gen({ tag: 'latest' }), /tag must look like/)
        await assert.rejects(gen({ tag: 'v1.2' }), /tag must look like/)
        assert.deepEqual(hits.filter((v) => v.includes('tags/')), []) //無效標籤不連網

        //zip 內無 k6.exe / 有兩個 k6.exe
        for (const files of [{ [`k6-${TAG}-windows-amd64/README.md`]: 'x' }, { [`k6-${TAG}-windows-amd64/k6.exe`]: exe, [`k6-${TAG}-windows-amd64/bin/k6.exe`]: exe }]) {
            resetRel()
            rel.zip = makeZip(path.join(fdt, 'zip2'), files)
            const h = hashBuf(rel.zip)
            rel.sums = sums(h.sha256)
            rel.api.assets[0] = { name: `k6-${TAG}-windows-amd64.zip`, size: h.size, digest: `sha256:${h.sha256}` }
            await assert.rejects(gen(), /exactly one k6\.exe/)
        }
        assert.ok(!fs.existsSync(fdWork))
    })

    it('命令列: 版本標籤格式有誤時離開碼 1, 不改動 bin/manifest.json、不留 ./tmp/genBinManifest', function () {
        const before = crypto.createHash('sha256').update(fs.readFileSync('bin/manifest.json')).digest('hex')
        const r = spawnSync(process.execPath, ['toolg/genBinManifest.mjs', '--tag', 'not-a-tag', '--dry'], { encoding: 'utf8', windowsHide: true })
        assert.equal(r.status, 1, r.stdout + r.stderr)
        assert.ok((r.stdout + r.stderr).includes('tag must look like'), r.stdout + r.stderr)
        const after = crypto.createHash('sha256').update(fs.readFileSync('bin/manifest.json')).digest('hex')
        assert.equal(after, before)
        assert.ok(!fs.existsSync('./tmp/genBinManifest'))
    })

})
