import type { DesktopBridge } from '../shared/protocol'

declare global {
  interface Window {
    succulent: DesktopBridge
  }
}

export {}
