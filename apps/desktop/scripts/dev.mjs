import { createServer } from 'vite'
import { spawn, execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { buildMain } from './lib/build-main.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lockPath = path.join(appRoot, '.dev.lock')

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function pidIsNode(pid) {
  if (process.platform !== 'win32') return true
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' })
    return /node\.exe/i.test(out)
  } catch {
    return false
  }
}

function killTree(pid) {
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
    } catch {
      // 目标可能已自行退出
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // 目标可能已自行退出
      }
    }
  }
}

// —— 启动自清理：Windows 下关终端窗口不会触发任何信号 handler，
//    残留的 dev 进程（vite 在本进程内）只能靠下次启动时按锁文件回收 ——
if (existsSync(lockPath)) {
  const old = Number.parseInt(readFileSync(lockPath, 'utf8'), 10)
  if (Number.isFinite(old) && old !== process.pid && pidAlive(old) && pidIsNode(old)) {
    console.info(`[dev] 清理上次残留的 dev 进程 (pid ${old})`)
    killTree(old)
  }
  rmSync(lockPath, { force: true })
}
writeFileSync(lockPath, String(process.pid))
process.on('exit', () => {
  try {
    rmSync(lockPath, { force: true })
  } catch {
    // 锁文件清理失败无碍
  }
})

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

// 退出路径统一收口：杀 electron 进程树 → 关 vite → 删锁
let closing = false
async function shutdown(code) {
  if (closing) return
  closing = true
  if (electron.pid) killTree(electron.pid)
  await server.close()
  try {
    rmSync(lockPath, { force: true })
  } catch {
    // 锁文件清理失败无碍
  }
  process.exit(code)
}
process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))
process.on('SIGBREAK', () => void shutdown(0))
process.on('uncaughtException', (err) => {
  console.error('[dev] uncaught exception:', err)
  void shutdown(1)
})
electron.on('close', (code) => void shutdown(code ?? 0))
