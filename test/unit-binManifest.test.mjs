//
// unit: bin/manifest.json 與外部執行檔之存放(不連網)
//
// 對應規格: 外部執行檔之存放下載校驗與離線(制式規格, C:\opensrcOper\dspec) S1、S3、S5、M1~M5、D1、E2、§8 T1、T2
// 本套件為主幹模式(floating)之廠商檔 k6: 清單記版本標籤之資產網址(不得 releases/latest)與 zip、解出之 k6.exe 之校驗值; k6 不鏡像入 repo, 故 T2 改驗清單網址之形式
//
import { strict as assert } from 'assert'
import fs from 'fs'
import path from 'path'
import { execFileSync, execSync } from 'child_process'
import { fileURLToPath } from 'url'
import fsEnsureBins from 'wsemi/src/fsEnsureBins.mjs'


let fdt = './test/_tmp/binManifest'
let fdDecoy = './bin-cache/__decoy__'
let fpBinDecoy = './bin/__decoy__.exe'

//manifestOf, 清單在 it 內讀(缺清單時單案失敗而非整檔載入失敗)
let manifestOf = () => JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))

//codeOf, 取程式碼行(去除 // 與 * 開頭之註解行)
let codeOf = (t) => t.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')


describe('bin/manifest.json', function () {
    this.timeout(120000)

    after(function () {
        fs.rmSync(fdt, { recursive: true, force: true })
        fs.rmSync(fdDecoy, { recursive: true, force: true })
        fs.rmSync(fpBinDecoy, { force: true })
        //誘餌檔可能使 bin-cache/ 被建立: 空夾才移除(開發機已有快取時不動)
        try {
            fs.rmdirSync('./bin-cache')
        }
        catch {
            //非空或不存在
        }
    })

    it('M1、M5: 為本套件之主幹模式清單(floating), 只含廠商檔 k6.exe', function () {
        const m = manifestOf()
        //規則: schema 1、pkg、mode、repo、manifestPath
        assert.equal(m.schema, 1)
        assert.equal(m.pkg, 'w-scan-stress')
        assert.equal(m.mode, 'floating')
        assert.equal(m.repo, 'yuda-lyu/w-scan-stress')
        assert.equal(m.manifestPath, 'bin/manifest.json')
        //規則(M2): 廠商檔以網址為來源, 無 path(不鏡像入 repo, S3), 主幹模式不需 commit
        assert.deepEqual(m.files.map((v) => v.name), ['k6.exe'])
        assert.equal(m.files[0].path, undefined)
        assert.equal(m.commit, undefined)
    })

    it('T2(廠商檔改驗網址): url 為版本標籤之資產網址(非 releases/latest), 與成員路徑之版本一致', function () {
        const f = manifestOf().files[0]
        //規則(S3、M2): 廠商 url 限 https://github.com/<owner>/<repo>/releases/download/<tag>/<檔>, 不得 releases/latest
        const r = /^https:\/\/github\.com\/grafana\/k6\/releases\/download\/(v\d+\.\d+\.\d+)\/(k6-v\d+\.\d+\.\d+-windows-amd64\.zip)$/.exec(f.url)
        assert.ok(r, f.url)
        assert.ok(!f.url.includes('/latest'))
        assert.equal(f.url.includes(`k6-${r[1]}-`), true)
        //規則(M1): 壓縮檔者記 extract(zip、成員路徑、解出之檔之校驗值)
        assert.equal(f.extract.type, 'zip')
        assert.equal(f.extract.member, `k6-${r[1]}-windows-amd64/k6.exe`)
    })

    it('M2、M3: 壓縮檔與解出之 k6.exe 各記 64 碼 sha256 與正整數大小, note 載明核對依據(廠商 checksums)', function () {
        const f = manifestOf().files[0]
        for (const p of [f, f.extract]) {
            assert.match(p.sha256, /^[0-9a-f]{64}$/)
            assert.ok(Number.isSafeInteger(p.size) && p.size > 0)
        }
        assert.notEqual(f.sha256, f.extract.sha256)
        //規則(M3): 廠商檔之雜湊以廠商公告之 checksums 核對, 於 note 載明依據
        assert.equal(typeof f.note, 'string')
        assert.ok(/checksums\.txt/.test(f.note), f.note)
        assert.ok(f.note.includes(`/releases/download/${/\/download\/(v[\d.]+)\//.exec(f.url)[1]}/`), f.note)
    })

    it('M1、M2: 通過 fsEnsureBins 之 schema 檢核(離線且快取為空資料夾時為 E_OFFLINE_MISSING, 清單無效時為 E_MANIFEST)', async function () {
        let err = null
        try {
            await fsEnsureBins('bin/manifest.json', { pkgRoot: '.', cacheDir: `${fdt}/cache`, mirror: '', offline: true })
        }
        catch (e) {
            err = e
        }
        assert.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
    })

    it('S5、M1 F12: 快取夾與測試暫存夾不入版控, bin/ 視為 binary(使工作樹之位元組等於 GitHub 之 blob)', function () {
        //規則: .gitignore 列 bin-cache/; .gitattributes 設 bin/** binary
        execFileSync('git', ['check-ignore', '-q', '--', 'bin-cache/x/k6.exe'], { windowsHide: true }) //被忽略時離開碼 0, 否則拋錯
        execFileSync('git', ['check-ignore', '-q', '--', 'test/_tmp/x/k6.exe'], { windowsHide: true })
        const attr = execFileSync('git', ['check-attr', 'binary', '--', 'bin/manifest.json'], { encoding: 'utf8', windowsHide: true })
        assert.ok(attr.trim().endsWith('binary: set'), attr)
    })

    it('S1、S5、T1: npm 包內不含外部執行檔與壓縮檔, bin/ 下只有 manifest.json', function () {
        //先放誘餌檔(缺忽略規則時確定性變紅): bin/、快取夾、測試暫存夾各放一個探針檔, 測試平行執行時他檔之暫存檔亦不得影響本案
        fs.mkdirSync(fdt, { recursive: true })
        fs.writeFileSync(`${fdt}/probe.exe`, 'x')
        fs.mkdirSync(fdDecoy, { recursive: true })
        fs.writeFileSync(`${fdDecoy}/probe.exe`, 'x')
        fs.writeFileSync(fpBinDecoy, 'x')
        const r = JSON.parse(execSync('npm pack --dry-run --json', { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }))
        const info = Array.isArray(r) ? r[0] : Object.values(r)[0] //npm 11 以前為陣列, npm 12 起為以套件名為鍵之物件
        const fps = info.files.map((v) => v.path)
        //規則(S1): 無 exe、dll、msi、zip、7z、分割檔
        assert.deepEqual(fps.filter((v) => /\.(exe|dll|msi|zip|7z|\d{3})$/i.test(v)), [])
        //規則(S1): bin/ 與 bin-cache/ 下只有 bin/manifest.json
        assert.deepEqual(fps.filter((v) => v.startsWith('bin/') || v.startsWith('bin-cache/')), ['bin/manifest.json'])
        //規則(S5): 測試暫存夾、指引文件夾不入包; 無舊的下載模組與舊路徑檔
        assert.deepEqual(fps.filter((v) => v.startsWith('test/_tmp/') || v.startsWith('sgud/')), [])
        assert.deepEqual(fps.filter((v) => v === 'src/download.mjs' || (/^src\/k6/i.test(v) && v.endsWith('.exe'))), [])
    })

})


describe('src/ 與 package.json: 不自寫下載、不於安裝時下載', function () {

    const fdSrc = './src'
    const fps = fs.readdirSync(fdSrc).filter((v) => v.endsWith('.mjs')).map((v) => path.join(fdSrc, v))

    it('E2: src/ 不自寫下載、快取、校驗、解壓(程式碼行不含 fetch(、api.github.com、releases/latest、tar.exe、fsDownloadFile(非 Verify))', function () {
        assert.ok(fps.length > 0)
        for (const fp of fps) {
            const c = codeOf(fs.readFileSync(fp, 'utf8'))
            assert.equal(/\bfetch\s*\(/.test(c), false, `${fp} calls fetch`)
            assert.equal(/api\.github\.com|releases\/latest|raw\.githubusercontent\.com/.test(c), false, `${fp} names a download source`)
            assert.equal(/tar\.exe|bsdtar|BSDTAR/i.test(c), false, `${fp} extracts by itself`)
            assert.equal(/fsDownloadFile(?!Verify)/.test(c), false, `${fp} imports fsDownloadFile`)
        }
    })

    it('原則 14: 已移除舊的下載模組 src/download.mjs 與其測試, 不留 @deprecated 薄包裝', function () {
        assert.equal(fs.existsSync('src/download.mjs'), false)
        assert.equal(fs.existsSync('test/unit-download.test.mjs'), false)
        for (const fp of fps) {
            assert.equal(/@deprecated/.test(fs.readFileSync(fp, 'utf8')), false, fp)
        }
        const cfg = fs.readFileSync('src/config.mjs', 'utf8')
        assert.equal(/\bTOOLS\b/.test(codeOf(cfg)), false, 'config.mjs still defines TOOLS')
    })

    it('D1: package.json 無 postinstall、preinstall、install; scripts 只有 test 與 deploy', function () {
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
        for (const k of ['postinstall', 'preinstall', 'install']) {
            assert.equal(Object.prototype.hasOwnProperty.call(pkg.scripts, k), false, k)
        }
        assert.deepEqual(Object.keys(pkg.scripts).sort(), ['deploy', 'test'])
    })

    it('E4: 相依 wsemi 1.9.27 以上(首個含 fsEnsureBins 之版本), 且已安裝版本亦然', function () {
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
        const ver = (s) => String(s).replace(/^[^0-9]*/, '').split('.').map((v) => parseInt(v, 10))
        const atLeast = (a, b) => {
            for (let i = 0; i < 3; i++) {
                if (a[i] !== b[i]) return a[i] > b[i]
            }
            return true
        }
        assert.ok(atLeast(ver(pkg.dependencies.wsemi), [1, 9, 27]), pkg.dependencies.wsemi)
        const fpEnsure = fileURLToPath(import.meta.resolve('wsemi/src/fsEnsureBins.mjs'))
        const installed = JSON.parse(fs.readFileSync(path.join(path.dirname(fpEnsure), '..', 'package.json'), 'utf8')).version
        assert.ok(atLeast(ver(installed), [1, 9, 27]), installed)
    })

    it('UMD 打包: gDistRollup 之 external 與 globals 含 fsEnsureBins 與 ensureBins 所需之內建模組', function () {
        const c = fs.readFileSync('toolg/gDistRollup.mjs', 'utf8')
        const ext = c.slice(c.indexOf('external:'))
        const glb = c.slice(c.indexOf('globals:'), c.indexOf('external:'))
        //規則: 規格 §9 要求含 url、crypto、stream、stream/promises 與交換檔所需之 os; wsemi 之 fsEnsureBins 另用未加 node: 前綴之 fs、path、child_process
        for (const m of ['url', 'crypto', 'stream', 'stream/promises', 'os', 'fs', 'path', 'child_process']) {
            assert.ok(ext.includes(`'${m}'`), `external lacks ${m}`)
            assert.ok(glb.includes(`'${m}':`), `globals lacks ${m}`)
        }
    })

    it('O5: README 有〈外部執行檔〉一節與〈Breaking changes〉, 載明環境變數、k6.exe、ensureBins、清單與離線部署', function () {
        const c = fs.readFileSync('README.md', 'utf8')
        assert.ok(c.includes('## 外部執行檔') || c.includes('#### 外部執行檔'))
        const sec = c.slice(c.search(/#+ 外部執行檔/))
        for (const k of ['W_BIN_CACHE', 'W_BIN_MIRROR', 'W_BIN_OFFLINE', 'k6.exe', 'ensureBins', 'bin/manifest.json', 'genBinManifest', 'E_OFFLINE_MISSING']) {
            assert.ok(sec.includes(k), `README section lacks ${k}`)
        }
        assert.ok(/#+ Breaking changes/.test(c))
        const br = c.slice(c.search(/#+ Breaking changes/))
        for (const k of ['fdTools', 'download.mjs', 'W_BIN_CACHE']) {
            assert.ok(br.includes(k), `Breaking changes lacks ${k}`)
        }
    })

})
