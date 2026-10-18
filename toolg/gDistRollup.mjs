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
    },
    external: [
        'node:path',
        'node:url',
        'node:os',
        'node:fs',
        'node:fs/promises',
        'node:child_process',
    ],
})
