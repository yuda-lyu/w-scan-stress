import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'
import getFiles from 'w-package-tools/src/getFiles.mjs'


let fdSrc = './src'
let fdTar = './dist'


rollupFiles({
    fns: 'WScanStress.mjs',
    fdSrc,
    fdTar,
    nameDistType: 'kebabCase',
    globals: {
        'node:path': 'path',
        'node:url': 'url',
        'node:os': 'os',
        'node:fs': 'fs',
        'node:fs/promises': 'fs/promises',
        'node:child_process': 'child_process',
        //wsemi之fsEnsureBins(ensureBins取得k6.exe)使用未加node:前綴之內建模組
        'path': 'path',
        'url': 'url',
        'os': 'os',
        'fs': 'fs',
        'child_process': 'child_process',
        'crypto': 'crypto',
        'stream': 'stream',
        'stream/promises': 'promises',
    },
    external: [
        'node:path',
        'node:url',
        'node:os',
        'node:fs',
        'node:fs/promises',
        'node:child_process',
        'path',
        'url',
        'os',
        'fs',
        'child_process',
        'crypto',
        'stream',
        'stream/promises',
    ],
})
