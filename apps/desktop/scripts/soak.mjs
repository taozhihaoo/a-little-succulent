/**
 * 8h/24h soak 测试（02 §7）：构建产物独立运行，定期采样资源到 CSV。
 * 用法：node scripts/soak.mjs [小时数，默认 8]
 * 独立 userData（soak 子目录），不影响日常存档；结束后打印摘要。
 */
import { spawn } from 'node:child_process'
import { execSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { buildMain } from './lib/build-main.mjs'

const hours = Number(process.argv[2] ?? 8)
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(appRoot, 'soak')
mkdirSync(outDir, { recursive: true })
const csvPath = path.join(outDir, `soak-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`)
writeFileSync(csvPath, 'timestamp,hours_elapsed,cpu_percent_total,working_set_mb,private_mb\n')

await buildMain()
console.info(`[soak] ${hours}h 开始；CSV: ${csvPath}`)

const electron = spawn(electronPath, [appRoot], {
  stdio: 'ignore',
  env: { ...process.env, SUCCULENT_SOAK: '1' },
})
const started = Date.now()

function sample() {
  const h = (Date.now() - started) / 3600000
  try {
    const out = execSync(
      `powershell -NoProfile -Command "$p=Get-Process electron -ErrorAction SilentlyContinue; $c=0; foreach($x in $p){$c+=$x.CPU}; $w=($p|Measure-Object WorkingSet64 -Sum).Sum/1MB; $v=($p|Measure-Object PrivateMemorySize64 -Sum).Sum/1MB; Write-Output (\\"$c|$w|$v\\")"`,
      { encoding: 'utf8' },
    ).trim()
    const [cpu, ws, priv] = out.split('|')
    appendFileSync(csvPath, `${new Date().toISOString()},${h.toFixed(3)},${cpu},${Math.round(ws)},${Math.round(priv)}\n`)
    console.info(`[soak] ${h.toFixed(2)}h cpu=${cpu} ws=${Math.round(ws)}MB priv=${Math.round(priv)}MB`)
  } catch (err) {
    console.warn('[soak] 采样失败', err)
  }
}
sample()
const sampler = setInterval(sample, 3600000)

function finish(reason) {
  clearInterval(sampler)
  sample()
  electron.kill()
  console.info(`[soak] 结束（${reason}）；报告: ${csvPath}`)
  process.exit(0)
}
electron.on('exit', () => finish('electron 退出'))
setTimeout(() => finish(`${hours}h 到时`), hours * 3600000)
