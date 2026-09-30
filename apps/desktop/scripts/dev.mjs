import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { buildMain } from './lib/build-main.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const server = await createServer({ root: appRoot, mode: 'development' })
await server.listen()
const url = server.resolvedUrls?.local?.[0]
if (!url) throw new Error('[dev] vite dev server did not return a local URL')

await buildMain()
console.info(`[dev] renderer: ${url}`)
console.info('[dev] launching electron…')

const child = spawn(electronPath, [appRoot], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RENDERER_URL: url },
})
child.on('close', async (code) => {
  await server.close()
  process.exit(code ?? 0)
})
