/**
 * A13 全屏检测（02 §4 渲染三态的 DeepIdle 触发源）。
 * spike 结论（koffi）：shell32 SHQueryUserNotificationState 一个调用即可判断
 * 是否有全屏应用在前台（QUNS 2=全屏 F11 / 3=全屏应用），无需窗口矩形比对。
 * koffi 自带预编译产物，无需 electron-rebuild；加载失败则禁用轮询（降级）。
 */
import { BrowserWindow } from 'electron'

let timer: ReturnType<typeof setInterval> | undefined
let last = false

export function startFullscreenWatcher(
  getWin: () => BrowserWindow | undefined,
  onFullscreen: (fullscreen: boolean) => void,
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- A13 spike：koffi 仅主进程动态加载（spike 结论：无需 electron-rebuild）
    const koffi = require('koffi') as typeof import('koffi')
    const lib = koffi.load('shell32.dll')
    const query = lib.func('__stdcall', 'SHQueryUserNotificationState', 'long', [
      koffi.out(koffi.pointer('int')),
    ])
    timer = setInterval(() => {
      try {
        const buf = Buffer.alloc(4)
        const ret = query(buf)
        if (ret !== 0) return
        const state = buf.readInt32LE(0)
        // QUNS: 2 = 全屏浏览器(F11) / 3 = 全屏应用；其余为桌面态
        const fullscreen = state === 2 || state === 3
        if (fullscreen !== last) {
          last = fullscreen
          console.info('[fullscreen] changed:', fullscreen)
          onFullscreen(fullscreen)
        }
      } catch {
        // 单次查询失败忽略（下个周期重试）
      }
    }, 5000)
  } catch (err) {
    console.warn('[fullscreen] koffi 不可用——全屏检测禁用（A13 spike 降级）', err)
  }
}

export function stopFullscreenWatcher(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}
