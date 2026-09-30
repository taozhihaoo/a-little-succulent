import { createServer } from 'vite'
import { spawn, execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync, watch } from 'node:fs'
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
//    残留的 dev 进程只能靠下次启动时按锁文件回收 ——
if (existsSync(lockPath)) {
  const old = Number.parseInt(readFileSync(lockPath, 'utf8'), 10)
  if (Number.isFinite(old) && old !== process.pid && pidAlive(old) && pidIsNode(old)) {
    console.info(`[dev] 清理上次残留的 dev 进程 (pid ${old})`)
    killTree(old)
  }
  rmSync(lockPath, { force: true })
}
writeFileSync(lockPath, String(process.pid))

const server = await createServer({ root: appRoot, mode: 'development' })
await server.listen()
const url = server.resolvedUrls?.local?.[0]
if (!url) throw new Error('[dev] vite dev server did not return a local URL')

await buildMain()
console.info(`[dev] renderer: ${url}`)
console.info('[dev] launching electron…')

let electron = null
let closing = false
let restarting = false

function launchElectron() {
  const child = spawn(electronPath, [appRoot, '--enable-logging'], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RENDERER_URL: url },
  })
  // 只有"当前实例"的退出才关闭整个 dev；重启时旧实例的 close 被忽略
  child.on('close', (code) => {
    if (closing || child !== electron) return
    void shutdown(code ?? 0)
  })
  electron = child
}

async function restartElectron(reason) {
  if (closing || restarting) return
  restarting = true
  console.info(`[dev] ${reason} → 重建 main/preload 并重启 electron…`)
  if (electron?.pid) killTree(electron.pid)
  try {
    await buildMain()
  } catch (err) {
    console.error('[dev] rebuild failed:', err)
    restarting = false
    return
  }
  launchElectron()
  restarting = false
}

launchElectron()

// main/preload 变更自动重建并重启（vite HMR 只覆盖 renderer）
let watchTimer
for (const dir of ['src/main', 'src/preload']) {
  watch(path.join(appRoot, dir), { recursive: true }, () => {
    clearTimeout(watchTimer)
    watchTimer = setTimeout(() => void restartElectron(`${dir} 变更`), 250)
  })
}

async function shutdown(code) {
  if (closing) return
  closing = true
  if (electron?.pid) killTree(electron.pid)
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
