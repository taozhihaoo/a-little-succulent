/**
 * Simulation Console 最低版（03 §3~§5 最小集）：
 * 时间控制（+1h/+1d/+7d/存档）、植物状态、事件列表、危险重置、种子码导入导出（M6-3）。
 * I 键切换；仅 DEV 构建。挂载期间每秒自刷新。
 */
import * as THREE from 'three'
import { decodeSeedCode, encodeSeedCode } from '@succulent/sim'
import type { DesktopBridge } from '../shared/protocol'

export interface ConsoleEngine {
  simTime: number
  world: {
    plants: {
      speciesId: string
      seed: string
      genome: { values: Record<string, number> }
      bornSimTime: number
      water: number
      leaves: { droppedSimTime?: number }[]
    }[]
  }
  events: readonly { simTime: number; kind: string; tier: string }[]
  advance(targetSimTime: number, maxSteps: number): { done: boolean }
  checkpoint(): unknown
}

export interface ConsoleDeps {
  bridge: DesktopBridge
  getEngine: () => ConsoleEngine | null
  advanceDays: (days: number) => void
  checkpoint: () => void
  /** 世界结构变化后由宿主刷新（sync/invalidate/checkpoint） */
  onWorldChanged?: () => void
}

let panel: HTMLDivElement | null = null
let timer: ReturnType<typeof setInterval> | undefined

const DAY = 86_400_000

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

function fmtPhase(simTime: number, utcOffsetMinutes: number): string {
  const local = ((simTime + utcOffsetMinutes * 60000) % 86400000 + 86400000) % 86400000
  const h = Math.floor(local / 3600000)
  return h < 6 || h >= 20 ? '夜' : h < 8 ? '晨' : h < 17 ? '昼' : '昏'
}

export function mountConsole(deps: ConsoleDeps): void {
  if (panel) return
  panel = document.createElement('div')
  panel.className = 'sim-console'
  panel.innerHTML = [
    '<div class="sc-head"><span>Simulation Console</span><button data-act="close">×</button></div>',
    '<div class="sc-row">',
    '  <button data-act="h1">+1h</button>',
    '  <button data-act="d1">+1d</button>',
    '  <button data-act="d7">+7d</button>',
    '  <button data-act="cp">存档</button>',
    '</div>',
    '<div class="sc-row">',
    '  <button data-act="seed">种子码</button>',
    '  <button data-act="import">导入种子码</button>',
    '</div>',
    '<div class="sc-row"><button data-act="reset">重置存档（危险）</button></div>',
    '<div class="sc-status">…</div>',
    '<div class="sc-events"></div>',
  ].join('\n')
  document.body.appendChild(panel)

  panel.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const act = target.dataset?.act
    const engine = deps.getEngine()
    if (act === 'close') return unmountConsole()
    if (!engine) return
    if (act === 'h1') deps.advanceDays(1 / 24)
    if (act === 'd1') deps.advanceDays(1)
    if (act === 'd7') deps.advanceDays(7)
    if (act === 'cp') deps.checkpoint()
    if (act === 'reset') {
      void deps.bridge.resetSave().then(() => window.location.reload())
    }
    if (act === 'seed') {
      const plant = engine.world.plants[0]
      if (!plant) return
      const code = encodeSeedCode({ speciesId: 'echeveria', seed: plant.seed, genome: plant.genome })
      // prompt 同时承担展示与复制（聚焦后 Ctrl+C），clipboard API 失败也不丢码
      window.prompt('种子码（聚焦后 Ctrl+C 复制）：', code)
    }
    if (act === 'import') {
      const raw = window.prompt('粘贴种子码：')
      if (!raw) return
      const decoded = decodeSeedCode(raw)
      if (!decoded) {
        window.alert('种子码无效（校验未通过）')
        return
      }
      const plants = engine.world.plants as {
        id: string
        speciesId: string
        seed: string
        genome: { values: Record<string, number> }
        bornSimTime: number
        water: number
        stress: { light: number; drought: number; temp: number }
        stretch: number
        seasonPhase: number
        leaves: { bornSimTime: number; ringIndex: number; maturity: number; turgor: number; colorState: number; damage: number; rand: number }[]
        stems: { heightMm: number; lignification: number }[]
        counters: Record<string, number>
      }[]
      if (plants.length >= 8) {
        window.alert('盆已满（Slot 上限 8）')
        return
      }
      plants.push({
        id: `${decoded.seed}-shared${plants.length}`,
        speciesId: decoded.speciesId,
        seed: decoded.seed,
        genome: decoded.genome,
        bornSimTime: engine.simTime,
        water: 0.7,
        stress: { light: 0, drought: 0, temp: 0 },
        stretch: 0,
        seasonPhase: 0,
        leaves: [
          { bornSimTime: engine.simTime, ringIndex: 0, maturity: 0.3, turgor: 1, colorState: 0, damage: 0, rand: 0.5 },
        ],
        stems: [{ heightMm: 2, lignification: 0 }],
        counters: {},
      })
      deps.onWorldChanged?.()
    }
  })

  timer = setInterval(() => {
    if (!panel) return
    const engine = deps.getEngine()
    const status = panel.querySelector('.sc-status')
    const evBox = panel.querySelector('.sc-events')
    if (!engine || !status || !evBox) return
    const plant = engine.world.plants[0]
    const age = plant ? Math.round((engine.simTime - plant.bornSimTime) / DAY) : 0
    const alive = plant ? plant.leaves.filter((l) => !l.droppedSimTime).length : 0
    const phase = fmtPhase(engine.simTime, -new Date().getTimezoneOffset())
    status.textContent =
      `sim ${fmtTime(engine.simTime)} · 苗龄 ${age}d · 水 ${plant?.water?.toFixed(2) ?? '-'} · 叶 ${alive} · ${phase}`
    const recent = engine.events.slice(-10).reverse()
    evBox.innerHTML = recent
      .map(
        (e) =>
          `<div class="sc-ev">${new Date(e.simTime).toLocaleTimeString('zh-CN', { hour12: false })} ${e.kind} <i>${e.tier}</i></div>`,
      )
      .join('')
  }, 1000)
}

export function unmountConsole(): void {
  if (timer) clearInterval(timer)
  timer = undefined
  panel?.remove()
  panel = null
}

void THREE
