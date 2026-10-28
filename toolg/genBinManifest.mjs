//產生bin/manifest.json(外部執行檔規格M1~M3: sha256與大小不手寫, 廠商檔以廠商公告之checksums核對)
//本套件為主幹模式(mode為floating, 主控帳本G10登記: 壓測工具須保持新版), 唯一之外部執行檔為廠商檔k6.exe(grafana/k6 Windows版zip內之k6.exe, 不鏡像入repo, 規格S3)
//用法:
//  node toolg/genBinManifest.mjs               查grafana/k6最新版 → 下載Windows zip與checksums檔 → 核對 → 寫入bin/manifest.json
//  node toolg/genBinManifest.mjs --tag v2.3.0  指定版本(不查最新版)
//  node toolg/genBinManifest.mjs --dry         乾跑: 同樣查詢、下載、核對, 但不寫bin/manifest.json, 只印出結果與相對現行清單之差異
//流程(規格U2、U3): 本工具 → 跑測試(npm test) → 與程式一併推GitHub主幹即生效(執行時取主幹清單); npm包內之基準清單於下次發布時隨包更新
//清單之網址為版本標籤之資產網址(/releases/download/<tag>/…), 不得為releases/latest(規格M2); 暫存於./tmp/genBinManifest/(結束時刪除)
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import fsDownloadFileVerify from 'wsemi/src/fsDownloadFileVerify.mjs'
import fsGetBinManifestEntry from 'wsemi/src/fsGetBinManifestEntry.mjs'
import fsEnsureBins from 'wsemi/src/fsEnsureBins.mjs'


//---- 廠商檔之設定(只改這段) ----

//vendor, 廠商檔: repo為GitHub儲存庫, name為清單之檔名, zipOf與sumsOf為該版本之Windows zip與checksums檔之資產檔名, exeName為zip內要取出之執行檔檔名
let vendor = {
    repo: 'grafana/k6',
    name: 'k6.exe',
    exeName: 'k6.exe',
    zipOf: (tag) => `k6-${tag}-windows-amd64.zip`,
    sumsOf: (tag) => `k6-${tag}-checksums.txt`,
}

//---- 以下不需修改 ----

let TAG_RE = /^v\d+\.\d+\.\d+$/

//tarProg, Windows為內建tar.exe(bsdtar, 須支援zip; Git Bash之tar為GNU tar不可用), 其他系統為bsdtar
let tarProg = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar'

let HEADERS = { 'User-Agent': 'w-scan-stress-genBinManifest', 'Accept': 'application/vnd.github+json' }


/**
 * 解析廠商公告之checksums檔(每行為`<sha256>  <檔名>`)
 *
 * @param {String} text 輸入checksums檔之文字
 * @returns {Map} 回傳以資產檔名為鍵、小寫sha256為值之Map，同名而雜湊不同者拋錯
 */
function parseChecksums(text) {
    let m = new Map()
    for (let line of String(text).split(/\r?\n/)) {
        let r = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim())
        if (r === null) {
            continue
        }
        let sha = r[1].toLowerCase()
        if (m.has(r[2]) && m.get(r[2]) !== sha) {
            throw new Error(`checksums lists ${r[2]} twice with different sha256`)
        }
        m.set(r[2], sha)
    }
    return m
}


//getText, 取文字(上限1MB), 非2xx即拋錯
async function getText(fetch, url) {
    let res = await fetch(url, { headers: HEADERS })
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${url}`)
    }
    let t = await res.text()
    if (t.length > 1024 * 1024) {
        throw new Error(`response larger than 1MB: ${url}`)
    }
    return t
}


/**
 * 查廠商發布、下載Windows zip與checksums檔、核對、解出執行檔，回傳清單物件
 *
 * zip之sha256取自廠商公告之checksums檔(規格M3), 大小取自GitHub API之資產size, 下載經fsDownloadFileVerify逐項校驗; API若附digest則須與checksums一致; 執行檔之sha256與大小為解出後自算
 *
 * @param {Object} opt 輸入設定物件
 * @param {String} opt.pkgName 輸入本套件名稱字串，如'w-scan-stress'
 * @param {String} opt.fdWork 輸入暫存資料夾路徑字串，結束時刪除
 * @param {String} [opt.tag=''] 輸入版本標籤字串，如'v2.3.0'，空字串為查最新版
 * @param {Function} [opt.fetch=globalThis.fetch] 輸入fetch函數(測試注入)
 * @param {String} [opt.date] 輸入記入note之日期字串，預設本機今日(YYYY-MM-DD)
 * @returns {Promise} 回傳Promise，resolve回傳{ tag, manifest }，核對不符或資產缺漏則reject回傳Error
 */
async function genBinManifest(opt) {
    let { pkgName, fdWork, tag = '' } = opt
    let fetch = opt.fetch || globalThis.fetch
    let date = opt.date || new Date().toLocaleDateString('sv-SE') //本機日期(YYYY-MM-DD)
    let api = `https://api.github.com/repos/${vendor.repo}/releases`
    let urlOf = (t, name) => `https://github.com/${vendor.repo}/releases/download/${t}/${name}`

    fs.rmSync(fdWork, { recursive: true, force: true })
    fs.mkdirSync(fdWork, { recursive: true })
    try {

        //廠商發布(版本標籤固定後, 清單網址即為該標籤之資產網址)
        if (tag !== '' && !TAG_RE.test(tag)) {
            throw new Error(`tag must look like v1.2.3: ${tag}`)
        }
        let rel = JSON.parse(await getText(fetch, tag === '' ? `${api}/latest` : `${api}/tags/${tag}`))
        if (!TAG_RE.test(rel.tag_name) || (tag !== '' && rel.tag_name !== tag)) {
            throw new Error(`unexpected tag_name of the release: ${rel.tag_name}`)
        }
        if (rel.draft === true || rel.prerelease === true) {
            throw new Error(`the release ${rel.tag_name} is a draft or a prerelease`)
        }
        tag = rel.tag_name
        let nameZip = vendor.zipOf(tag)
        let nameSums = vendor.sumsOf(tag)
        let assets = Array.isArray(rel.assets) ? rel.assets : []
        let aZip = assets.find((v) => v.name === nameZip)
        let aSums = assets.find((v) => v.name === nameSums)
        if (!aZip || !aSums) {
            throw new Error(`the release ${tag} lacks the asset ${!aZip ? nameZip : nameSums}`)
        }
        if (!Number.isSafeInteger(aZip.size) || aZip.size <= 0) {
            throw new Error(`the asset ${nameZip} has no valid size: ${aZip.size}`)
        }

        //核對: zip之sha256取自廠商公告之checksums檔; API附digest時須一致
        let sums = parseChecksums(await getText(fetch, urlOf(tag, nameSums)))
        let sha = sums.get(nameZip)
        if (sha === undefined) {
            throw new Error(`${nameSums} does not list ${nameZip}`)
        }
        let digest = typeof aZip.digest === 'string' ? aZip.digest.toLowerCase() : ''
        if (digest !== '' && digest !== `sha256:${sha}`) {
            throw new Error(`the API digest of ${nameZip} (${digest}) differs from ${nameSums} (sha256:${sha})`)
        }

        //下載(sha256與大小皆須相符才落檔)
        let urlZip = urlOf(tag, nameZip)
        let fpZip = path.join(fdWork, 'asset.zip')
        await fsDownloadFileVerify(urlZip, fpZip, { sha256: sha, size: aZip.size }, { fetch })

        //解出執行檔: 先列出成員, 須恰有一個檔名為執行檔者
        let list = execFileSync(tarProg, ['-tf', 'asset.zip'], { cwd: fdWork, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
        let members = list.split(/\r?\n/).filter((v) => v !== '' && !v.endsWith('/') && path.posix.basename(v) === vendor.exeName)
        if (members.length !== 1) {
            throw new Error(`${nameZip} must hold exactly one ${vendor.exeName}: ${JSON.stringify(members)}`)
        }
        let member = members[0]
        let fdX = path.join(fdWork, 'x')
        fs.mkdirSync(fdX)
        execFileSync(tarProg, ['-xf', '../asset.zip', '--', member], { cwd: fdX, windowsHide: true })
        let eZip = await fsGetBinManifestEntry(fpZip, { name: vendor.name, url: urlZip })
        let eExe = await fsGetBinManifestEntry(path.join(fdX, ...member.split('/')))

        let note = `核對依據: 壓縮檔之sha256與廠商公告之${nameSums}(${urlOf(tag, nameSums)})一致${digest !== '' ? ', 並與GitHub API之digest一致' : ''}, 大小取自GitHub API; 解出之${vendor.exeName}之sha256與大小為下載後自算(規格M3); 查得日${date}`
        let manifest = {
            schema: 1,
            pkg: pkgName,
            mode: 'floating',
            repo: `yuda-lyu/${pkgName}`,
            manifestPath: 'bin/manifest.json',
            files: [
                { ...eZip, extract: { type: 'zip', member, sha256: eExe.sha256, size: eExe.size }, note },
            ],
        }

        //fsEnsureBins之schema檢核: 離線且快取為空資料夾時, 清單有效為E_OFFLINE_MISSING, 無效為E_MANIFEST(不連網)
        let err = await fsEnsureBins(manifest, { pkgRoot: fdWork, cacheDir: path.join(fdWork, 'cache'), mirror: '', offline: true }).then(() => null, (e) => e)
        if (!err || err.code !== 'E_OFFLINE_MISSING') {
            throw new Error(`the generated manifest does not pass the schema check of fsEnsureBins: ${err ? err.message : 'no error'}`)
        }

        return { tag, manifest }
    }
    finally {
        fs.rmSync(fdWork, { recursive: true, force: true })
    }
}


//tagOf, 取清單中k6之版本標籤(清單網址為版本標籤之資產網址)
let tagOf = (manifest) => {
    let r = /\/releases\/download\/(v\d+\.\d+\.\d+)\//.exec((manifest && manifest.files && manifest.files[0] && manifest.files[0].url) || '')
    return r === null ? '' : r[1]
}

//stripNote, 比較用: 去除note(含查得日)
let stripNote = (manifest) => {
    return JSON.stringify({ ...manifest, files: manifest.files.map(({ note, ...o }) => o) }) // eslint-disable-line no-unused-vars
}

let main = async () => {
    let argv = process.argv
    let i = argv.indexOf('--tag')
    let tag = i >= 0 ? String(argv[i + 1] || '') : ''
    let dry = argv.includes('--dry')
    let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    let fp = 'bin/manifest.json'
    let prev = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : null

    let r = await genBinManifest({ pkgName: pkg.name, fdWork: path.resolve('./tmp/genBinManifest'), tag })

    let changed = prev === null || stripNote(prev) !== stripNote(r.manifest)
    console.log(`${vendor.repo}: current manifest ${prev === null ? '(none)' : tagOf(prev) || '(unknown)'} → ${r.tag}, ${changed ? 'CHANGED' : 'unchanged (sha256 and size verified again)'}`)
    for (let f of r.manifest.files) {
        console.log(`  ${f.name}: ${f.url}`)
        console.log(`    archive  sha256 ${f.sha256} (${f.size} bytes)`)
        console.log(`    ${f.extract.member}  sha256 ${f.extract.sha256} (${f.extract.size} bytes)`)
    }
    if (dry) {
        console.log(`dry run: ${fp} not written`)
        return
    }
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    fs.writeFileSync(fp, `${JSON.stringify(r.manifest, null, 2)}\n`)
    console.log(`${fp}: ${r.manifest.files.length} file(s) written`)
}


export { genBinManifest, parseChecksums }

if (path.resolve(process.argv[1] || '').toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase()) {
    main().catch((err) => {
        console.log(err)
        process.exit(1)
    })
}
