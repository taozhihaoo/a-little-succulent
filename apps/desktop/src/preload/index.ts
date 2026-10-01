import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type DesktopBridge } from '../shared/protocol'

const bridge: DesktopBridge = {
  version: '0.0.1',
  setIgnoreMouseEvents(ignore: boolean) {
    ipcRenderer.send(IpcChannels.SetIgnoreMouseEvents, ignore)
  },
  dragStart() {
    ipcRenderer.send(IpcChannels.DragStart)
  },
  dragMove() {
    ipcRenderer.send(IpcChannels.DragMove)
  },
  dragEnd() {
    ipcRenderer.send(IpcChannels.DragEnd)
  },
  setBounds(width: number, height: number) {
    ipcRenderer.send(IpcChannels.SetBounds, width, height)
  },
  focusWindow() {
    ipcRenderer.send(IpcChannels.FocusWindow)
  },
  async loadSave() {
    return ipcRenderer.invoke(IpcChannels.PersistenceLoad)
  },
  async checkpoint(saveJson: string, newEventLines: string) {
    await ipcRenderer.invoke(IpcChannels.PersistenceCheckpoint, saveJson, newEventLines)
  },
  appendInput(line: string) {
    ipcRenderer.send(IpcChannels.PersistenceAppendInput, line)
  },
  onFlushRequest(cb: () => void) {
    ipcRenderer.on(IpcChannels.AppFlushRequest, () => cb())
  },
  onFullscreen(cb: (fullscreen: boolean) => void) {
    ipcRenderer.on(IpcChannels.FullscreenChanged, (_e, fs: unknown) => cb(fs === true))
  },
  sendFlushDone() {
    ipcRenderer.send(IpcChannels.AppFlushDone)
  },
  async resetSave() {
    await ipcRenderer.invoke(IpcChannels.PersistenceReset)
  },
  async getSettings() {
    return ipcRenderer.invoke(IpcChannels.SettingsGet)
  },
  async setSettings(patch) {
    return ipcRenderer.invoke(IpcChannels.SettingsSet, patch)
  },
  onSettingsChanged(cb) {
    ipcRenderer.on(IpcChannels.SettingsChanged, (_e, s) => cb(s))
  },
  onOpenSettings(cb) {
    ipcRenderer.on(IpcChannels.AppOpenSettings, () => cb())
  },
  onUpdateReady(cb) {
    ipcRenderer.on(IpcChannels.AppUpdateReady, () => cb())
  },
  async checkForUpdate() {
    return ipcRenderer.invoke(IpcChannels.AppUpdateCheck)
  },
}
contextBridge.exposeInMainWorld('succulent', bridge)
