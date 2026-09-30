import {
  createEngine,
  createWorld,
  gridTarget,
  judgeWallDelta,
  parseSave,
  type InputEvent,
  type InputWal,
  type PhenotypeSnapshot,
  type SimEngine,
  type SimEvent,
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

// —— 垂直切片（07 §7）+ M3 存档：SimEngine → snapshot → PlantRenderer ——
const DAY = 86_400_000
const SEED = 'echeveria-001'
/** 初始苗龄（模拟日）：45 天；仅用于全新开始 */
const INITIAL_AGE_DAYS = 45

let engine: ReturnType<typeof createEngine> | null = null
let flushedEvents = 0

// 输入 WAL：会话内存镜像 + IPC 追加（fire-and-forget，崩溃窗口毫秒级）
const sessionInputs: InputEvent[] = []
const ipcWal: InputWal = {
  append(input) {
    sessionInputs.push(input)
    bridge.appendInput(JSON.stringify(input))
  },
}

const plantRenderer = new PlantRenderer(root.scene, true, scheduler)

function sync(): void {
  if (!engine) return
  const snapshot: PhenotypeSnapshot = engine.latestSnapshot()
  plantRenderer.update(snapshot)
}

function checkpoint(): void {
  if (!engine) return
  const save = engine.checkpoint()
  save.lastWallSeen = Date.now()
  save.eventCount = flushedEvents
  const newEvents = engine.events.slice(flushedEvents)
  const payload = newEvents.map((e) => JSON.stringify(e)).join('\n')
  flushedEvents = engine.events.length
  void bridge.checkpoint(JSON.stringify(save), payload)
}

/** 02 §6.4 载入流程：检查点 → 截断后的事件前缀 → WAL 重放 → 墙钟追赶 */
async function bootSim(): Promise<void> {
  const data = await bridge.loadSave()
  if (data.saveJson) {
    try {
      const save = parseSave(data.saveJson)
      if (save.formatVersion === 1) {
        const events: SimEvent[] = data.eventLines.map((l) => JSON.parse(l) as SimEvent)
        const eventSeq = events.length > 0 ? (events[events.length - 1]!.seq ?? 0) : 0
        flushedEvents = events.length
        engine = createEngine({
          world: save.world,
          events,
          eventSeq,
          inputSeq: save.inputWalOffset,
          wal: ipcWal,
        })
        // 墙钟追赶 + 回拨保护（02 §1.2 / §1.4）
        const verdict = judgeWallDelta(save.lastWallSeen, Date.now())
        if (verdict.status === 'ok') {
          engine.advance(gridTarget(Date.now()), Number.MAX_SAFE_INTEGER)
        } else {
          console.warn('[sim] 检测到系统时钟回拨——本次会话模拟时间冻结')
        }
        console.info('[sim] 存档已恢复：sim =', new Date(engine.simTime).toLocaleString())
        sync()
        return
      }
      console.warn('[sim] 存档格式版本不支持——重新开始')
    } catch (err) {
      console.error('[sim] 存档损坏——重新开始', err)
    }
  }
  engine = createEngine({
    world: createWorld(SEED, Date.now() - INITIAL_AGE_DAYS * DAY, {
      placement: 'windowsill',
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
      hemisphere: 'north',
    }),
    wal: ipcWal,
  })
  engine.advance(Date.now(), Number.MAX_SAFE_INTEGER)
  console.info('[sim] 全新开始')
  sync()
}

void bootSim()

// —— dev：昼夜预览与一日延时的互斥状态 ——
const DAY_PREVIEW = [0.31, 0.5, 0.69, 0.97]
let previewIdx = -1
let lapseActive = false
let lapseStartMs = 0
let lapseBasePhase = 0
const LAPSE_MS = 60000

root.onFrame = (frameTimeMs) => {
  plantRenderer.updateEffects(frameTimeMs)
  if (!engine) return
  if (lapseActive) {
    const t = (performance.now() - lapseStartMs) / LAPSE_MS
    root.setDayPhase((lapseBasePhase + t) % 1)
    scheduler.requestFrames(1200)
  } else if (previewIdx === -1) {
    root.setDayPhase(engine.latestSnapshot().dayPhase)
  }
}

// 会话内低频推进 + 检查点（02 §1.2 / §6.2）
setInterval(() => {
  if (!engine) return
  engine.advance(Date.now(), Number.MAX_SAFE_INTEGER)
  scheduler.invalidate()
  sync()
  checkpoint()
}, 30_000)

// dev：] = 快进 7 模拟日 + 立即检查点（快进必须可持久化）
window.addEventListener('keydown', (e) => {
  if (!import.meta.env.DEV || !engine) return
  if (e.code === 'BracketRight') {
    engine.advance(engine.simTime + 7 * DAY, Number.MAX_SAFE_INTEGER)
    sync()
    scheduler.invalidate()
    checkpoint()
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
  if (!import.meta.env.DEV || !engine) return
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
