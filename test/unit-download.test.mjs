//
// unit: k6 之取得(src/download.mjs), 只替換網路(globalThis.fetch), 檔案系統為真
//
// 對應規則(src/download.mjs 之說明, README 之〈無外網(內網)使用〉):
//   查詢最新版, toolsDir 內已有該版執行檔(含 zip 解壓後位於子資料夾者)即略過下載; 否則下載至暫存夾、解壓後改名為 toolsDir/<工具>/<版本>, 不留 zip 與暫存夾;
//   無法連網(查詢失敗)或 offline 時, 沿用 toolsDir 內已快取之最新版本(依版本號比較, 暫存夾不視為版本); 皆無則拋錯並指出放置之位置
//
import { strict as assert } from 'assert'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { ensureTool, cmpVerDesc, findLatestCached } from '../src/download.mjs'
import { TOOLS } from '../src/config.mjs'


describe('download', function () {
    this.timeout(60000)

    let root = path.resolve('./test/_tmp/download')
    let fdTools = path.join(root, 'tools')
    let tool = TOOLS.find((t) => t.key === 'k6')
    let fetch0 = globalThis.fetch
    let calls //網路之請求紀錄
    let release //GitHub API 之回應, 為 null 時視為無法連網
    let assetBody
    let log = () => {}

    //put, 於版本夾放置執行檔(sub 為子資料夾)
    let put = (ver, sub, content) => {
        let fd = path.join(fdTools, 'k6', ver, sub)
        fs.mkdirSync(fd, { recursive: true })
        fs.writeFileSync(path.join(fd, 'k6.exe'), content)
        return path.join(fd, 'k6.exe')
    }

    //makeZip, 以 Windows 內建 bsdtar 製作 zip(與 download.mjs 解壓所用者同一工具), 執行檔位於子資料夾(同 k6 官方之 zip)
    let makeZip = (sub, content) => {
        let src = path.join(root, 'zipsrc')
        fs.rmSync(src, { recursive: true, force: true })
        fs.mkdirSync(path.join(src, sub), { recursive: true })
        fs.writeFileSync(path.join(src, sub, 'k6.exe'), content)
        let zip = path.join(root, 'k6.zip')
        let tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
        let r = spawnSync(tar, ['-a', '-cf', zip, '-C', src, sub], { encoding: 'utf8' })
        assert.equal(r.status, 0, r.stderr)
        return fs.readFileSync(zip)
    }

    beforeEach(function () {
        fs.rmSync(root, { recursive: true, force: true })
        fs.mkdirSync(root, { recursive: true })
        calls = []
        release = null
        assetBody = null
        globalThis.fetch = async (url) => {
            calls.push(url)
            if (url.startsWith('https://api.github.com/')) {
                if (!release) throw new Error('fetch failed')
                return { ok: true, json: async () => release }
            }
            return { ok: true, arrayBuffer: async () => assetBody.buffer.slice(assetBody.byteOffset, assetBody.byteOffset + assetBody.byteLength) }
        }
    })

    afterEach(function () {
        globalThis.fetch = fetch0
    })

    after(function () {
        fs.rmSync(root, { recursive: true, force: true })
        assert.ok(!fs.existsSync(root))
    })

    it('cmpVerDesc: 依版本號由新至舊(非字串順序)', function () {
        //規則: 依版本號比較
        assert.deepEqual(['v2.2.0', 'v2.10.0', 'v1.9.9', 'v2.2'].sort(cmpVerDesc), ['v2.10.0', 'v2.2.0', 'v2.2', 'v1.9.9'])
    })

    it('offline: 不查詢, 沿用已快取之最新版本(子資料夾內之執行檔亦可), 暫存夾不視為版本', async function () {
        put('v2.2.0', 'k6-v2.2.0-windows-amd64', 'old')
        let fpNew = put('v2.10.0', 'k6-v2.10.0-windows-amd64', 'new')
        put('.tmp', 'v9.9.9-x', 'partial')
        let r = await ensureTool(tool, { toolsDir: fdTools, offline: true, log })
        //規則: offline時不連網
        assert.deepEqual(calls, [])
        //規則: 沿用已快取之最新版本(依版本號), 暫存夾不視為版本
        assert.deepEqual(r, { key: 'k6', version: 'v2.10.0', exePath: fpNew, cached: true })
    })

    it('無法連網(查詢失敗): 沿用已快取之最新版本並告知', async function () {
        let fp = put('v2.2.0', 'k6-v2.2.0-windows-amd64', 'old')
        let logs = []
        let r = await ensureTool(tool, { toolsDir: fdTools, log: (m) => logs.push(m) })
        //規則: 查詢失敗時沿用已快取之版本
        assert.equal(r.exePath, fp)
        assert.equal(r.version, 'v2.2.0')
        assert.ok(logs.some((m) => m.includes('改用已快取之版本')), logs.join('\n'))
        //規則: 查詢失敗後不下載資產
        assert.equal(calls.length, 1)
    })

    it('無法連網且無快取: 拋錯並指出放置之位置', async function () {
        //規則: 皆無則拋錯, 指出 toolsDir/k6/<版本>
        await assert.rejects(ensureTool(tool, { toolsDir: fdTools, offline: true, log }), (err) => {
            assert.ok(err.message.includes('內無已快取之版本'))
            assert.ok(err.message.includes(path.join(fdTools, 'k6', '<版本>')))
            return true
        })
    })

    it('可連網且已有最新版(子資料夾內之執行檔): 不下載', async function () {
        let fp = put('v2.3.0', 'k6-v2.3.0-windows-amd64', 'cached')
        release = { tag_name: 'v2.3.0', assets: [{ name: 'k6-v2.3.0-windows-amd64.zip', browser_download_url: 'https://example.invalid/k6.zip' }] }
        let r = await ensureTool(tool, { toolsDir: fdTools, log })
        //規則: 已存在對應版本之exe(含位於子資料夾者)即略過下載
        assert.deepEqual(r, { key: 'k6', version: 'v2.3.0', exePath: fp, cached: true })
        assert.deepEqual(calls, ['https://api.github.com/repos/grafana/k6/releases/latest'])
    })

    it('可連網且無該版: 下載 zip 並解壓至版本夾, 不留 zip 與暫存夾', async function () {
        put('v2.2.0', 'k6-v2.2.0-windows-amd64', 'old')
        assetBody = makeZip('k6-v2.3.0-windows-amd64', 'new-exe')
        release = {
            tag_name: 'v2.3.0',
            assets: [
                { name: 'k6-v2.3.0-linux-amd64.tar.gz', browser_download_url: 'https://example.invalid/linux' },
                { name: 'k6-v2.3.0-windows-amd64.zip', browser_download_url: 'https://example.invalid/k6.zip' },
            ],
        }
        let r = await ensureTool(tool, { toolsDir: fdTools, log })
        let verDir = path.join(fdTools, 'k6', 'v2.3.0')
        //規則: 取Windows之zip資產
        assert.equal(calls[1], 'https://example.invalid/k6.zip')
        //規則: 解壓至toolsDir/k6/<版本>, 執行檔可位於子資料夾
        assert.deepEqual(r, { key: 'k6', version: 'v2.3.0', exePath: path.join(verDir, 'k6-v2.3.0-windows-amd64', 'k6.exe'), cached: false })
        assert.equal(fs.readFileSync(r.exePath, 'utf8'), 'new-exe')
        //規則: 不留zip
        assert.deepEqual(fs.readdirSync(verDir), ['k6-v2.3.0-windows-amd64'])
        //規則: 不留暫存夾
        assert.deepEqual(fs.readdirSync(path.join(fdTools, 'k6')).sort(), ['v2.2.0', 'v2.3.0'])
        //規則: 之後離線時沿用此最新版
        assert.equal((await findLatestCached(tool, fdTools)).version, 'v2.3.0')
    })

    it('可連網但無 Windows 資產: 拋錯', async function () {
        release = { tag_name: 'v2.3.0', assets: [{ name: 'k6-v2.3.0-linux-amd64.tar.gz', browser_download_url: 'https://example.invalid/linux' }] }
        //規則: 找不到符合的Windows資產則拋錯
        await assert.rejects(ensureTool(tool, { toolsDir: fdTools, log }), /找不到符合的 Windows 資產/)
    })

})
