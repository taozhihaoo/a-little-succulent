import { contextBridge } from 'electron'
import type { DesktopBridge } from '../shared/protocol'

const bridge: DesktopBridge = { version: '0.0.1' }
contextBridge.exposeInMainWorld('succulent', bridge)
