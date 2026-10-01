import {
  createEngine,
  createRng,
  createWorld,
  gridTarget,
  judgeWallDelta,
  parseSave,
  type InputEvent,
  type SimEvent,
  makeJitteredGenome,
  ECHEVERIA_VIVID_GENOME,
} from '@succulent/sim'
import { mountConsole, unmountConsole } from '../dev/console'
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
async function applyInput(input: InputEvent): Promise<void> {
  // WAL written ahead of state (02 sect 6.4)
  await bridge.appendInput(JSON.stringify(input))
  engine?.apply(input, { skipWal: true })
}

// M4-8：多植株渲染——母株居中（露珠仅母株），子株按 Slot 顺序排右侧
const plantRenderers = new Map<string, { renderer: PlantRenderer; slot: number }>()
const SLOT_GAP = 115 // mm
const parentRenderer = (): PlantRenderer => plantRenderers.values().next().value!.renderer

function sync(): void {
  const eng = engine
  if (!eng) return
  const plants = eng.world.plants
  // 移除已消失植株的渲染器
  for (const [id, entry] of plantRenderers) {
    if (!plants.some((pl) => pl.id === id)) {
      entry.renderer.dispose()
      plantRenderers.delete(id)
    }
  }
  plants.forEach((plant, i) => {
    let entry = plantRenderers.get(plant.id)
    if (!entry) {
      const renderer = new PlantRenderer(root.scene, i === 0, scheduler)
      entry = { renderer, slot: i }
      plantRenderers.set(plant.id, entry)
      renderer.group.position.x = i === 0 ? 0 : 95 + (i - 1) * SLOT_GAP
      hitTest.rescan()
    }
    entry.renderer.update(eng.latestSnapshot(plant.id))
  })
}
sync()

async function checkpoint(): Promise<void> {
  if (!engine) return
  const save = engine.checkpoint()
  save.lastWallSeen = Date.now()
  save.eventCount = flushedEvents
  const newEvents = engine.events.slice(flushedEvents)
  const payload = newEvents.map((e) => JSON.stringify(e)).join('\n')
  flushedEvents = engine.events.length
  await bridge.checkpoint(JSON.stringify(save), payload)
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
  })
  engine.advance(Date.now(), Number.MAX_SAFE_INTEGER)
  console.info('[sim] 全新开始')
  sync()
}

void bootSim()

// —— dev：昼夜预览与一日延时的互斥状态 ——
const DAY_PREVIEW = [0.31, 0.5, 0.69, 0.97]
let previewIdx = -1
let consoleMounted = false
let lapseActive = false
let lapseStartMs = 0
let lapseBasePhase = 0
const LAPSE_MS = 60000

root.onFrame = (frameTimeMs) => {
  for (const { renderer } of plantRenderers.values()) renderer.updateEffects(frameTimeMs)
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
// dev：Shift+V 切换写实/绚丽（替换当前植株基因组；dev 预览用途，重载回存档）
let styleVivid = false
let exitContactSheet: (() => void) | null = null
window.addEventListener('keydown', (e) => {
  if (!import.meta.env.DEV) return
  if (e.code === 'KeyC' && e.shiftKey && !exitContactSheet) {
    void import('../dev/contact-sheet').then((m) => {
      exitContactSheet = m.mountContactSheet(root, parentRenderer(), bridge)
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
  if (e.code === 'KeyI' && !e.shiftKey) {
    if (consoleMounted) {
      unmountConsole()
      consoleMounted = false
    } else {
      mountConsole({
        bridge,
        getEngine: () => engine,
        advanceDays: (days) => {
          if (!engine) return
          engine.advance(engine.simTime + days * DAY, Number.MAX_SAFE_INTEGER)
          sync()
          scheduler.invalidate()
          checkpoint()
        },
        checkpoint: () => checkpoint(),
      })
      consoleMounted = true
    }
    return
  }
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
  if (menuOpen) return
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

// M3 menu: water = first real player input (InputEvent -> WAL)
let menuOpen = false
const menu = document.createElement('div')
menu.className = 'ctx-menu'
const waterBtn = document.createElement("button")
waterBtn.textContent = '浇水'
menu.appendChild(waterBtn)
document.body.appendChild(menu)

function closeMenu(): void {
  menuOpen = false
  menu.style.display = 'none'
}

async function waterPlant(): Promise<void> {
  if (!engine) return
  await applyInput({ seq: 0, simTime: engine.simTime, type: 'water' })
  sync()
  scheduler.invalidate()
  checkpoint()
  parentRenderer().waterBurst(performance.now())
}

waterBtn.addEventListener('click', () => {
  waterPlant()
  closeMenu()
})

container.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  if (!engine || !hitTest(e.clientX, e.clientY)) {
    closeMenu()
    return
  }
  menuOpen = true
  menu.style.left = Math.min(e.clientX, window.innerWidth - 140) + "px"
  menu.style.top = Math.min(e.clientY, window.innerHeight - 60) + "px"
  menu.style.display = 'block'
  bridge.setIgnoreMouseEvents(false)
})

document.addEventListener('pointerdown', (e) => {
  if (menuOpen && e.target instanceof Node && !menu.contains(e.target)) closeMenu()
})

// 退出前落盘（主进程 before-quit 请求）
bridge.onFullscreen((fs) => {
  scheduler.setPhase(fs ? 'DeepIdle' : previewIdx === -1 && !lapseActive ? 'Ambient' : scheduler.phase)
})

bridge.onFlushRequest(async () => {
  await checkpoint()
  bridge.sendFlushDone()
})

window.addEventListener('keydown', (e) => {
  if (!import.meta.env.DEV) return
  if (e.code === 'KeyV' && e.shiftKey && engine) {
    styleVivid = !styleVivid
    const base = styleVivid ? ECHEVERIA_VIVID_GENOME : undefined
    const plant = engine.world.plants[0]
    if (plant) {
      const genome = makeJitteredGenome(createRng(SEED + (styleVivid ? '|vivid' : '|genome')), base)
      plant.genome.values = genome.values
      engine.refresh()
    }
    sync()
    scheduler.invalidate()
    console.info('[dev] style =', styleVivid ? 'vivid' : 'realistic')
  }
})

// M5-5 拍照：Shift+P 截图下载（透明背景 PNG；文件名含苗龄）。主进程静默存入系统下载目录。
function toast(msg: string): void {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = msg
  document.body.appendChild(el)
  requestAnimationFrame(() => el.classList.add('show'))
  setTimeout(() => {
    el.classList.remove('show')
    setTimeout(() => el.remove(), 350)
  }, 2400)
}

window.addEventListener('keydown', (e) => {
  if (!engine || !e.shiftKey || e.code !== 'KeyP') return
  // 无 preserveDrawingBuffer：必须同一任务内"渲染一帧 → 读像素"，跨任务会读到空帧
  root.renderer.render(root.scene, root.camera)
  root.renderer.domElement.toBlob((blob) => {
    if (!blob || !engine) return
    const plant = engine.world.plants[0]
    const age = Math.max(0, Math.round((engine.simTime - (plant?.bornSimTime ?? engine.simTime)) / DAY))
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `succulent-${age}d-${stamp}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    toast(`📸 已保存照片（苗龄 ${age} 天）`)
  })
  const flash = document.createElement('div')
  flash.className = 'photo-flash'
  document.body.appendChild(flash)
  requestAnimationFrame(() => flash.classList.add('fade'))
  setTimeout(() => flash.remove(), 450)
})

console.info('[renderer] up; bridge =', bridge?.version ?? 'none')
