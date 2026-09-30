import {
  createEngine,
  createWorld,
  type PhenotypeSnapshot,
} from '@succulent/sim'
import {
  createSceneRoot,
  makeHitTester,
  PlantRenderer,
  RenderScheduler,
} from '@succulent/render'
import './style.css'

const container = document.getElementById('app')
if (!container) throw new Error('#app not found')

const bridge = window.succulent
const root = createSceneRoot(container)
const scheduler = new RenderScheduler(root)
scheduler.start()

// —— 垂直切片（07 §7）：SimEngine → snapshot → PlantRenderer ——
// M1 阶段模拟跑在 renderer 主线程（InProcessSimHost，07 §2）；存档/WAL 接线属 M3。
const DAY = 86_400_000
const SEED = 'echeveria-001'
/** 初始苗龄（模拟日）：45 天 ≈ 9~10 片叶的少年莲座；M3 存档系统落地后由存档决定 */
const INITIAL_AGE_DAYS = 45

const world = createWorld(SEED, Date.now() - INITIAL_AGE_DAYS * DAY, {
  placement: 'windowsill',
  utcOffsetMinutes: -new Date().getTimezoneOffset(),
  hemisphere: 'north',
})
const engine = createEngine({ world })
engine.advance(Date.now(), Number.MAX_SAFE_INTEGER) // 启动补算

const plantRenderer = new PlantRenderer(root.scene, true, scheduler)

function sync(): void {
  const snapshot: PhenotypeSnapshot = engine.latestSnapshot()
  plantRenderer.update(snapshot)
}
sync()

// —— dev：昼夜预览与一日延时的互斥状态 ——
// K = 四相预览锁定（晨/午/昏/夜/回到模拟时间）；L = 一日延时（60 秒播完 24 小时）。
const DAY_PREVIEW = [0.31, 0.5, 0.69, 0.97]
let previewIdx = -1
let lapseActive = false
let lapseStartMs = 0
let lapseBasePhase = 0
const LAPSE_MS = 60000

root.onFrame = (frameTimeMs) => {
  plantRenderer.updateEffects(frameTimeMs)
  if (lapseActive) {
    const t = (performance.now() - lapseStartMs) / LAPSE_MS
    root.setDayPhase((lapseBasePhase + t) % 1)
    scheduler.requestFrames(1200) // 滚动续帧：延时渐变平滑不被 Ambient 间隙打断
  } else if (previewIdx === -1) {
    root.setDayPhase(engine.latestSnapshot().dayPhase)
  }
}

// 会话内低频推进（02 §1.2）；持久化调度属 M3
setInterval(() => {
  engine.advance(Date.now(), Number.MAX_SAFE_INTEGER)
  scheduler.invalidate()
  sync()
}, 30_000)

// dev：] = 快进 7 模拟日（目标必须是引擎 simTime——用 Date.now() 会在首次快进后空转）
window.addEventListener('keydown', (e) => {
  if (!import.meta.env.DEV) return
  if (e.code === 'BracketRight') {
    engine.advance(engine.simTime + 7 * DAY, Number.MAX_SAFE_INTEGER)
    sync()
    scheduler.invalidate()
    const plant = engine.world.plants[0]
    const alive = plant?.leaves.filter((l) => l.droppedSimTime === undefined).length ?? 0
    const ageDays = Math.round((engine.simTime - (plant?.bornSimTime ?? 0)) / DAY)
    console.info(`[dev] +7d; plant age = ${ageDays}d, alive leaves = ${alive}`)
  }
})

// dev：Shift+C 开 100 株联系表（03 §7），Esc 退出；Shift+S 在表内导出 PNG。仅 DEV 构建。
let exitContactSheet: (() => void) | null = null
window.addEventListener('keydown', (e) => {
  if (!import.meta.env.DEV) return
  if (e.code === 'KeyC' && e.shiftKey && !exitContactSheet) {
    void import('../dev/contact-sheet').then((m) => {
      exitContactSheet = m.mountContactSheet(root, plantRenderer, bridge)
      hitTest.rescan()
    })
  } else if (e.code === 'Escape' && exitContactSheet) {
    exitContactSheet()
    exitContactSheet = null
    hitTest.rescan()
  }
})

// dev：K = 四相昼夜预览锁定；L = 一日延时。任一激活会取消另一个。
window.addEventListener('keydown', (e) => {
  if (!import.meta.env.DEV) return
  if (e.code === 'KeyL' && !e.shiftKey) {
    lapseActive = !lapseActive
    previewIdx = -1
    if (lapseActive) {
      lapseBasePhase = engine.latestSnapshot().dayPhase
      lapseStartMs = performance.now()
    }
    console.info('[dev] day lapse =', lapseActive ? 'ON (60s per day)' : 'OFF')
    return
  }
  if (e.code === 'KeyK' && !e.shiftKey) {
    lapseActive = false
    previewIdx = (previewIdx + 1) % (DAY_PREVIEW.length + 1)
    const phase =
      previewIdx === DAY_PREVIEW.length ? engine.latestSnapshot().dayPhase : DAY_PREVIEW[previewIdx]!
    root.setDayPhase(phase)
    scheduler.invalidate()
    scheduler.requestFrames(600)
    console.info(
      '[dev] dayPhase preview =',
      previewIdx === DAY_PREVIEW.length ? 'sim time' : phase,
    )
    return
  }
})

// A3：PointerHitResolver 渲染侧——命中实体才接收鼠标，空白区穿透（forward 保持事件回流）
const hitTest = makeHitTester(root)

// A4：拖动生命周期交给主进程做屏幕坐标锚定；renderer 只报事件（rAF 节流 IPC）
let dragging = false
let moveQueued = false

container.addEventListener('pointermove', (e) => {
  if (dragging) {
    if (moveQueued) return
    moveQueued = true
    requestAnimationFrame(() => {
      moveQueued = false
      if (dragging) bridge.dragMove()
    })
    return
  }
  bridge.setIgnoreMouseEvents(!hitTest(e.clientX, e.clientY))
})

container.addEventListener('pointerdown', (e) => {
  if (hitTest(e.clientX, e.clientY)) {
    dragging = true
    bridge.dragStart()
    bridge.focusWindow()
    container.setPointerCapture(e.pointerId)
  }
})

function endDrag(): void {
  if (dragging) {
    dragging = false
    bridge.dragEnd()
  }
}

container.addEventListener('pointerup', endDrag)
container.addEventListener('pointercancel', endDrag)

console.info('[renderer] up; bridge =', bridge?.version ?? 'none')
