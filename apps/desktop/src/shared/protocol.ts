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
  /** main -> renderer: flush request before quit */
  AppFlushRequest: 'app:flush-request',
  /** main -> renderer: A13 fullscreen app detected (DeepIdle trigger) */
  FullscreenChanged: 'desktop:fullscreen-changed',
  /** renderer -> main: flush done */
  AppFlushDone: 'app:flush-done',
  /** renderer → main：清除全部存档文件（dev 危险操作） */
  PersistenceReset: 'persistence:reset',
  /** renderer → main：读取用户设置（M7-3） */
  SettingsGet: 'settings:get',
  /** renderer → main：部分更新设置（主进程应用+原子持久化） */
  SettingsSet: 'settings:set',
  /** main → renderer：设置已变更（推送新值） */
  SettingsChanged: 'settings:changed',
  /** main → renderer：托盘"设置"菜单项（打开设置面板） */
  AppOpenSettings: 'app:open-settings',
  /** main → renderer：新版本已下载，退出时自动安装（M7-2） */
  AppUpdateReady: 'app:update-ready',
  /** renderer → main：手动检查更新（设置面板，M7-2） */
  AppUpdateCheck: 'app:update-check',
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/** 用户设置（M7-3）。主进程独有 settings.json——save.json 的唯一写入方是 renderer 检查点流，
 *  而窗口属性主进程启动期就要读，双写会引入竞争。 */
export interface AppSettings {
  /** 窗口/内容缩放 0.6~1.4（1 = 基准 380×460） */
  windowScale: number
  /** 整窗不透明度 0.4~1.0 */
  opacity: number
  /** 开机自启（仅打包版生效） */
  launchAtLogin: boolean
  /** 空白处鼠标穿透（false = 整窗可拖动/点击） */
  passthroughWhenIdle: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  windowScale: 1,
  opacity: 1,
  launchAtLogin: false,
  passthroughWhenIdle: true,
}

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
  onFlushRequest(cb: () => void): void
  onFullscreen(cb: (fullscreen: boolean) => void): void
  sendFlushDone(): void
  resetSave(): Promise<void>
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  onSettingsChanged(cb: (s: AppSettings) => void): void
  onOpenSettings(cb: () => void): void
  onUpdateReady(cb: () => void): void
  checkForUpdate(): Promise<{ packaged: boolean; checking?: boolean }>
}
