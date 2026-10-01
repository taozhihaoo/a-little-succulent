/**
 * 打包输出目录选择器：electron-builder 会先清空输出目录，但上一次打包版的运行实例
 * 退出后 asar 偶发被系统句柄（Defender/索引器）短暂锁住——A/B 双目录轮流用，
 * 被锁的那个跳过即可，无需手工清理。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2) // 透传给 electron-builder，如 --dir
const dirs = ['distA', 'distB']

let out = dirs[0]
for (const d of dirs) {
  try {
    if (existsSync(d)) rmSync(d, { recursive: true, force: true })
    out = d
    break
  } catch {
    // 目录被锁 → 试下一个
  }
}
console.info(`[dist] output = ${out}`)

// Windows 下 npx.cmd 无法以 shell:false spawn（EINVAL），直接用 node 调 electron-builder 的 cli.js
const cli = path.join(appRoot, '../../node_modules/electron-builder/cli.js')
const r = spawnSync(process.execPath, [cli, ...args, `--config.directories.output=${out}`], {
  stdio: 'inherit',
  cwd: appRoot,
})
process.exit(r.status ?? 1)
