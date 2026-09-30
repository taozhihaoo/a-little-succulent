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

const electron = spawn(electronPath, [appRoot, '--enable-logging'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RENDERER_URL: url },
})

// Ctrl+C / 异常退出时清理子进程与 dev server，避免孤儿进程占端口
let closing = false
async function shutdown(code) {
  if (closing) return
  closing = true
  electron.kill()
  await server.close()
  process.exit(code)
}
process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))
process.on('uncaughtException', (err) => {
  console.error('[dev] uncaught exception:', err)
  void shutdown(1)
})
electron.on('close', (code) => void shutdown(code ?? 0))
