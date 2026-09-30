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

const world = createWorld(SEED, Date.now() - 6 * DAY, {
  placement: 'windowsill',
  utcOffsetMinutes: -new Date().getTimezoneOffset(),
  hemisphere: 'north',
})
const engine = createEngine({ world })
engine.advance(Date.now(), Number.MAX_SAFE_INTEGER) // 启动补算（约 6 模拟日）

const plantRenderer = new PlantRenderer(root.scene)

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

// dev：] = 快进 1 模拟日（正式工具是 Simulation Console，03）
window.addEventListener('keydown', (e) => {
  if (e.key === ']') {
    engine.advance(Date.now() + DAY, Number.MAX_SAFE_INTEGER)
    sync()
    console.info('[dev] advanced +1 sim day; leaves =', engine.world.plants[0]?.leaves.length)
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
