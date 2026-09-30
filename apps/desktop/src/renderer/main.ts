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
root.onFrame = (frameTimeMs) => {
  plantRenderer.updateEffects(frameTimeMs)
  root.setDayPhase(engine.latestSnapshot().dayPhase)
}

function sync(): void {
  const snapshot: PhenotypeSnapshot = engine.latestSnapshot()
  plantRenderer.update(snapshot)
}
sync()

// 会话内低频推进（02 §1.2）；持久化调度属 M3
setInterval(() => {
  engine.advance(Date.now(), Number.MAX_SAFE_INTEGER)
  scheduler.invalidate()
  sync()
}, 30_000)

// dev：] = 快进 7 模拟日（必出 1~2 片新叶；正式工具是 Simulation Console，03）
// 注意 1：需先点击植物让窗口获得键盘焦点
// 注意 2：目标必须是引擎当前 simTime + 7d——用 Date.now() 会在首次快进后全部空转
window.addEventListener('keydown', (e) => {
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
      hitTest.rescan() // 网格清单刷新：联系表的 1300+ 网格要参与命中测试
    })
  } else if (e.code === 'Escape' && exitContactSheet) {
    exitContactSheet()
    exitContactSheet = null
    hitTest.rescan()
  }
})

// dev：K 键循环预览晨/午/昏/夜（正式昼夜跟随模拟时间）
const DAY_PREVIEW = [0.31, 0.5, 0.69, 0.97]
let previewIdx = -1
window.addEventListener('keydown', (e) => {
  if (!import.meta.env.DEV || e.code !== 'KeyK' || e.shiftKey) return
  previewIdx = (previewIdx + 1) % (DAY_PREVIEW.length + 1)
  const phase = previewIdx === DAY_PREVIEW.length ? engine.latestSnapshot().dayPhase : DAY_PREVIEW[previewIdx]!
  root.setDayPhase(phase)
  scheduler.invalidate()
  scheduler.requestFrames(600)
  console.info('[dev] dayPhase preview =', previewIdx === DAY_PREVIEW.length ? 'sim time' : phase)
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
