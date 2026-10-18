//
// unit: 文件與程式之同步(README、jsdoc 之 @example、g.mjs、主函數讀取之 opt 鍵)
//
// 對應規則(CLAUDE_rulebook.md 之 R12):
//   主函數(src/WScanStress.mjs)與 normOpt(src/config.mjs)讀取之每個 opt.<鍵>, 皆在 README〈Options〉表與主函數 jsdoc 之 @param 出現;
//   README 之範例、主函數 jsdoc 之 @example 與 g.mjs 之範例為同一份程式(僅 import 行不同)
//
import { strict as assert } from 'assert'
import fs from 'fs'

let read = (fp) => fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n')
let readme = read('./README.md')
let main = read('./src/WScanStress.mjs')
let config = read('./src/config.mjs')
let g = read('./g.mjs')


//codeOf, 取程式碼行(去除 // 與 * 開頭之註解行)
let codeOf = (t) => t.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

//body, 範例由 async function test() 起至 console.log(err) 止
let body = (t) => {
    let i = t.indexOf('async function test() {')
    let j = t.indexOf('console.log(err)', i)
    assert.ok(i >= 0 && j > i, '找不到範例')
    return t.slice(i, j)
}


describe('docs: opt 鍵與文件同步', function () {

    let keys = [...new Set([...(codeOf(main) + codeOf(config)).matchAll(/\bopt\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))].sort()

    it('主函數讀取之 opt 鍵: 皆有 README 說明與 jsdoc @param', function () {
        //規則: 至少涵蓋已知之鍵(防止擷取失效而空轉)
        for (let k of ['buildScenario', 'getSessions', 'levels', 'gate', 'label', 'procPorts', 'k6Path', 'quiet']) {
            assert.ok(keys.includes(k), `未擷取到 opt.${k}`)
        }
        for (let k of keys) {
            //規則: README〈Options〉表以`鍵`列出
            assert.ok(readme.includes(`\`${k}\``), `README 缺 \`${k}\``)
            //規則: 主函數jsdoc以@param列出(巢狀鍵如 opt.gate.x 不另列)
            assert.ok(new RegExp(`@param \\{[^}]+\\} \\[?opt\\.${k}[\\]=\\s]`).test(main), `jsdoc 缺 @param opt.${k}`)
        }
    })

})


describe('docs: 範例同步', function () {

    it('README、jsdoc @example 與 g.mjs 之範例一致', function () {
        let i = main.indexOf('@example')
        let j = main.indexOf('*/', i)
        let ex = main.slice(i, j).split('\n').slice(1).map((l) => l.replace(/^ \* ?/, '')).join('\n')
        //規則: 三處範例同一份(g.mjs 為源, README 與 jsdoc 為其複本)
        assert.equal(body(readme), body(g))
        assert.equal(body(ex), body(g))
    })

})
