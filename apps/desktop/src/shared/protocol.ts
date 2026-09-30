/** 类型化 IPC 注册表（07 §5）：main 与 preload 共用同一份类型，通道字符串不散落。 */

export const IpcChannels = {
  /** renderer → main：动态切换鼠标穿透（A3） */
  SetIgnoreMouseEvents: 'desktop:set-ignore-mouse-events',
  /** renderer → main：拖动生命周期（A4）。主进程用屏幕坐标锚定，窗口钉在光标上 */
  DragStart: 'desktop:drag-start',
  DragMove: 'desktop:drag-move',
  DragEnd: 'desktop:drag-end',
  /** renderer → main：调整窗口尺寸（联系表等 dev 工具需要大视口） */
  SetBounds: 'desktop:set-bounds',
  /** renderer → main：窗口抢键盘焦点（K/] 等快捷键依赖焦点） */
  FocusWindow: 'desktop:focus-window',
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/** preload 暴露给 renderer 的最小桥 */
export interface DesktopBridge {
  version: string
  setIgnoreMouseEvents(ignore: boolean): void
  dragStart(): void
  dragMove(): void
  dragEnd(): void
  setBounds(width: number, height: number): void
  focusWindow(): void
}
