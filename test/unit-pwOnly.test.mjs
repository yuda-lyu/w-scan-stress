//
// unit: Chromium 系瀏覽器之啟動一律經 w-playwright(靜態盤點, 不啟動瀏覽器)
//
// 對應規則(sgud/rule/rulebook.md 之 R16, 同 w-playwright 帳本之 R-PW-ONLY):
//   本套件之 src、test、toolg 與根目錄之 .mjs 不得以靜態匯入、動態匯入、require 引用 playwright 或 playwright-core;
//   package.json 不得宣告 playwright、playwright-core, 且宣告 w-playwright(src/capture.mjs 於執行期使用)
//
import { strict as assert } from 'assert'
import fs from 'fs'
import path from 'path'


//reImport, 同 w-playwright 帳本 R-PW-ONLY 之盤點正則(靜態匯入、動態匯入、require, 套件名 playwright 或 playwright-core 或其子路徑)
let reImport = /(from\s+|import\(\s*|require\(\s*)['"`]playwright(-core)?['"`/]/

//reDecl, package.json 之宣告
let reDecl = /"playwright(-core)?"\s*:/

//listFiles, 列出資料夾內(遞迴)之 .mjs 與 .js, 不含 node_modules 與測試中之臨時資料夾(test/_tmp)
let listFiles = (fd) => {
    let out = []
    if (!fs.existsSync(fd)) return out
    for (let d of fs.readdirSync(fd, { withFileTypes: true })) {
        let fp = path.join(fd, d.name)
        if (d.isDirectory()) {
            if (d.name === 'node_modules' || d.name === '_tmp') continue
            out.push(...listFiles(fp))
        }
        else if (/\.(mjs|js)$/.test(d.name)) {
            out.push(fp)
        }
    }
    return out
}

let files = [
    ...listFiles('./src'),
    ...listFiles('./test'),
    ...listFiles('./toolg'),
    ...fs.readdirSync('.').filter((n) => /\.(mjs|js)$/.test(n)),
].map((fp) => fp.replace(/\\/g, '/'))


describe('R-PW-ONLY: 啟動一律經 w-playwright', function () {

    it('盤點正則: 正例(四種寫法)皆命中, 反例不命中; 盤點範圍含 src/capture.mjs(防空集合)', function () {
        //規則: 盤點指令須能命中靜態匯入、動態匯入、require 與子路徑(正例); 空集合不算通過
        let q = (s) => `'${s}'`
        let pos = [
            `import { chromium } from ${q('playwright')}`,
            `import(${q('playwright')})`,
            `require(${q('playwright-core')})`,
            `import x from ${q('playwright-core/lib/x.js')}`,
        ]
        for (let s of pos) assert.ok(reImport.test(s), s)
        //規則: w-playwright 與註解/字串中提及套件名不算引用
        for (let s of [`import wpw from ${q('w-playwright')}`, '// 使用 playwright 之瀏覽器']) assert.ok(!reImport.test(s), s)
        assert.ok(files.includes('src/capture.mjs'), files.join(','))
        assert.ok(files.length > 10, String(files.length))
    })

    it('src、test、toolg 與根目錄之 .mjs/.js: 無直接匯入 playwright、playwright-core', function () {
        let hits = []
        for (let fp of files) {
            fs.readFileSync(fp, 'utf8').split(/\r?\n/).forEach((l, i) => {
                if (reImport.test(l)) hits.push(`${fp}:${i + 1}: ${l.trim()}`)
            })
        }
        //規則: 本套件無任何直接匯入(w-playwright 之外)
        assert.deepEqual(hits, [])
    })

    it('package.json: 不宣告 playwright、playwright-core, 宣告 w-playwright(dependencies, 執行期使用)', function () {
        let txt = fs.readFileSync('./package.json', 'utf8')
        //規則: 不直接依賴 playwright、playwright-core(版本由 w-playwright 擁有)
        assert.ok(!reDecl.test(txt), '仍宣告 playwright 或 playwright-core')
        let pkg = JSON.parse(txt)
        //規則: src/capture.mjs 於執行期經 w-playwright 啟動瀏覽器, 故為 dependencies 而非 devDependencies
        assert.match(pkg.dependencies['w-playwright'] || '', /^\^1\./)
        assert.equal(pkg.devDependencies && pkg.devDependencies['w-playwright'], undefined)
    })

})
