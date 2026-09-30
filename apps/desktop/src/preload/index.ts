import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type DesktopBridge } from '../shared/protocol'

const bridge: DesktopBridge = {
  version: '0.0.1',
  setIgnoreMouseEvents(ignore: boolean) {
    ipcRenderer.send(IpcChannels.SetIgnoreMouseEvents, ignore)
  },
  dragWindow(dx: number, dy: number) {
    ipcRenderer.send(IpcChannels.DragWindow, dx, dy)
  },
}
contextBridge.exposeInMainWorld('succulent', bridge)
