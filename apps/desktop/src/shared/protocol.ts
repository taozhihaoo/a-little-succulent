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
  /** renderer → main：载入存档（检查点 + 输入 WAL + 事件日志，02 §6.4） */
  PersistenceLoad: 'persistence:load',
  /** renderer → main：检查点原子落盘 + 追加新事件 */
  PersistenceCheckpoint: 'persistence:checkpoint',
  /** renderer → main：输入 WAL 追加（预写日志） */
  PersistenceAppendInput: 'persistence:append-input',
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/** preload 暴露给 renderer 的最小桥 */
/** 存档载荷（02 §6.4 载入流程的输入） */
export interface SavePayload {
  saveJson: string | null
  inputLines: string[]
  eventLines: string[]
}

export interface DesktopBridge {
  version: string
  setIgnoreMouseEvents(ignore: boolean): void
  dragStart(): void
  dragMove(): void
  dragEnd(): void
  setBounds(width: number, height: number): void
  focusWindow(): void
  loadSave(): Promise<SavePayload>
  checkpoint(saveJson: string, newEventLines: string): Promise<void>
  appendInput(line: string): void
}
