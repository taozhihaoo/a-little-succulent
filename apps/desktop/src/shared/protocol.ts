/** 类型化 IPC 注册表（07 §5）：main 与 preload 共用同一份类型，通道字符串不散落。 */

export const IpcChannels = {
  /** renderer → main：动态切换鼠标穿透（A3） */
  SetIgnoreMouseEvents: 'desktop:set-ignore-mouse-events',
  /** renderer → main：手动拖动窗口（A4；禁用 CSS drag region） */
  DragWindow: 'desktop:drag-window',
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/** preload 暴露给 renderer 的最小桥 */
export interface DesktopBridge {
  version: string
  setIgnoreMouseEvents(ignore: boolean): void
  dragWindow(dx: number, dy: number): void
}
