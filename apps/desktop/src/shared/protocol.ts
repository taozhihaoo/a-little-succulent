/** 类型化 IPC 注册表（07 §5）：main 与 preload 共用同一份类型，通道字符串不散落。 */

export const IpcChannels = {
  /** renderer → main：手动拖动窗口（A4；禁用 CSS drag region） */
  DragWindow: 'desktop:drag-window',
  /** main → renderer：托盘动作回传（A6） */
  TrayAction: 'desktop:tray-action',
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/** preload 暴露给 renderer 的最小桥 */
export interface DesktopBridge {
  version: string
}
