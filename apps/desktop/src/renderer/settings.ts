/**
 * M7-3 设置面板：正式版的用户设置 UI（S 键 / 托盘"设置"打开）。
 * 大小 / 透明度 / 开机自启 / 空白穿透 / 重置存档。
 * 面板是独立 DOM（body 下 fixed），容器缩放只作用于 #app，不影响面板可读性。
 */
import type { AppSettings, DesktopBridge } from '../shared/protocol'

export interface SettingsDeps {
  bridge: DesktopBridge
  /** 应用内容缩放（#app zoom；窗口尺寸由主进程负责） */
  applyContentScale: (scale: number) => void
  /** 穿透行为切换（false = 整窗可交互） */
  applyPassthrough: (passthroughWhenIdle: boolean) => void
  toast: (msg: string) => void
}

let panel: HTMLDivElement | null = null
let open = false
let applyTimer: ReturnType<typeof setTimeout> | undefined

function row(label: string, control: string): string {
  return `<div class="s-row"><span class="s-label">${label}</span>${control}</div>`
}

export function mountSettings(deps: SettingsDeps): void {
  if (panel) return
  panel = document.createElement('div')
  panel.className = 'settings-panel'
  panel.style.display = 'none'
  document.body.appendChild(panel)

  const render = (s: AppSettings): void => {
    panel!.innerHTML = [
      '<div class="j-head"><span>设置</span><button class="j-close" data-act="close" title="关闭">×</button></div>',
      row(
        '大小',
        `<input type="range" data-key="windowScale" min="0.6" max="1.4" step="0.05" value="${s.windowScale}">` +
          `<span class="s-val">${Math.round(s.windowScale * 100)}%</span>`,
      ),
      row(
        '透明度',
        `<input type="range" data-key="opacity" min="0.4" max="1" step="0.05" value="${s.opacity}">` +
          `<span class="s-val">${Math.round(s.opacity * 100)}%</span>`,
      ),
      row(
        '开机自启',
        `<input type="checkbox" data-key="launchAtLogin" ${s.launchAtLogin ? 'checked' : ''}>`,
      ),
      row(
        '空白处穿透',
        `<input type="checkbox" data-key="passthroughWhenIdle" ${s.passthroughWhenIdle ? 'checked' : ''}>`,
      ),
      '<div class="s-row"><button class="s-danger" data-act="reset">重置存档（回到新苗）</button></div>',
      '<div class="s-hint">改动即时生效并自动保存</div>',
    ].join('')
  }

  const push = (patch: Partial<AppSettings>): void => {
    clearTimeout(applyTimer)
    applyTimer = setTimeout(() => {
      void deps.bridge.setSettings(patch).then((next) => {
        deps.applyContentScale(next.windowScale)
        deps.applyPassthrough(next.passthroughWhenIdle)
      })
    }, 120)
  }

  panel.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement
    const key = t.dataset?.key as keyof AppSettings | undefined
    if (!key) return
    if (t.type === 'range') push({ [key]: Number(t.value) })
    if (t.type === 'checkbox') push({ [key]: t.checked })
  })

  panel.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t.dataset?.act === 'close') {
      toggle()
      return
    }
    if (t.dataset?.act === 'reset') {
      if (window.confirm('确定重置吗？当前植株与全部记录会被清除，回到一株新苗。')) {
        void deps.bridge.resetSave().then(() => window.location.reload())
      }
    }
  })

  deps.bridge.onSettingsChanged((s) => {
    deps.applyContentScale(s.windowScale)
    deps.applyPassthrough(s.passthroughWhenIdle)
    if (open) render(s)
  })

  deps.bridge.onOpenSettings(() => {
    if (!open) toggle()
  })

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyS' || e.shiftKey || e.ctrlKey || e.altKey || e.repeat) return
    toggle()
  })

  function toggle(): void {
    if (!panel) return
    open = !open
    if (open) {
      void deps.bridge.getSettings().then(render)
      panel.style.display = 'block'
    } else {
      panel.style.display = 'none'
    }
  }
}

export function isSettingsOpen(): boolean {
  return open
}

/** 面板包围盒（供穿透判定使用；未打开返回 null） */
export function settingsBounds(): { left: number; top: number; right: number; bottom: number } | null {
  if (!panel || !open || panel.style.display === 'none') return null
  const r = panel.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}
