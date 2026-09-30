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
}
contextBridge.exposeInMainWorld('succulent', bridge)
