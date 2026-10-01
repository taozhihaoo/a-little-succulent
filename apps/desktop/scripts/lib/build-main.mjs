import esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 主进程与 preload 打包（esbuild；vite 只负责 renderer）。
 *  主进程必须 CJS（.cjs）：package.json type=module 下 .js 视为 ESM，
 *  ESM 上下文里 externals（koffi 原生模块）的 require 垫片会炸——打包版实测。 */
export async function buildMain() {
  await esbuild.build({
    entryPoints: [path.join(appRoot, 'src/main/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron', 'koffi'],
    outfile: path.join(appRoot, 'out/main/index.cjs'),
    sourcemap: 'inline',
    // CJS 里 import.meta 不存在（esbuild 置 undefined，fileURLToPath 会炸——打包版实测）：
    // define 成 banner 里由 __filename 派生的真值
    define: { 'import.meta.url': 'import_meta_url' },
    banner: { js: "const import_meta_url = require('url').pathToFileURL(__filename).href;" },
  })
  await esbuild.build({
    entryPoints: [path.join(appRoot, 'src/preload/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    outfile: path.join(appRoot, 'out/preload/index.cjs'),
    sourcemap: 'inline',
  })
}
