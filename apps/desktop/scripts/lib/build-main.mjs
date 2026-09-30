import esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 主进程与 preload 打包（esbuild；vite 只负责 renderer）。 */
export async function buildMain() {
  await esbuild.build({
    entryPoints: [path.join(appRoot, 'src/main/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['electron'],
    outfile: path.join(appRoot, 'out/main/index.js'),
    sourcemap: 'inline',
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
