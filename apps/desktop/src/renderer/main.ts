import {
  createEngine,
  createRng,
  createWorld,
  gridTarget,
  judgeWallDelta,
  parseSave,
  reanchorSimTime,
  decodeSeedCode,
  encodeSeedCode,
  type InputEvent,
  type SimEvent,
  makeJitteredGenome,
  ECHEVERIA_VIVID_GENOME,
} from '@succulent/sim'
import { mountConsole, unmountConsole } from '../dev/console'
import { ACHIEVEMENT_DEFS, achievementsForEvent, derivedAchievements } from '../shared/achievements'
import { appendSeedling, type SeedlingPlant } from '../shared/seedling'
import { mountSettings, settingsBounds } from './settings'
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
const SLOT_GAP = 88 // mm（M5-6 紧凑化：群生感）

/** M5-6：按 id 哈希的稳定 z 偏移（[-12,12]mm）——存档重载后群生布局不变 */
function plantJitter(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return (((h >>> 0) % 1000) / 999 - 0.5) * 24
}

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
      const scale = i === 0 ? 1 : 0.85 // M5-6：子株微缩，母株为主角
      renderer.group.scale.setScalar(scale)
      renderer.group.position.set(
        i === 0 ? 0 : 95 + (i - 1) * SLOT_GAP,
        0,
        i === 0 ? 0 : plantJitter(plant.id),
      )
      hitTest.rescan()
    }
    entry.renderer.update(eng.latestSnapshot(plant.id))
  })
}
sync()

async function checkpoint(): Promise<void> {
  if (!engine) return
  const save = engine.checkpoint({ achievements: [...unlockedAchievements] })
  save.lastWallSeen = Date.now()
  save.eventCount = flushedEvents
  const newEvents = engine.events.slice(flushedEvents)
  const payload = newEvents.map((e) => JSON.stringify(e)).join('\n')
  flushedEvents = engine.events.length
  await bridge.checkpoint(JSON.stringify(save), payload)
}

// M6-4 成就：事件驱动解锁 + 世界派生条件，存档 appState 持久化（M7 换 Steamworks unlock）
const unlockedAchievements = new Set<string>()
let achievementCursor = 0
const achievementById = new Map(ACHIEVEMENT_DEFS.map((d) => [d.id, d]))

function unlockAchievement(id: string): void {
  if (unlockedAchievements.has(id)) return
  unlockedAchievements.add(id)
  const def = achievementById.get(id)
  if (def) toast(`🏆 成就解锁：${def.title}——${def.desc}`)
}

function evaluateAchievements(): void {
  const eng = engine
  if (!eng) return
  // 只评估本会话新产生的事件（历史事件不补发 toast）
  for (const ev of eng.events.slice(achievementCursor)) {
    for (const id of achievementsForEvent(ev.kind)) unlockAchievement(id)
  }
  achievementCursor = eng.events.length
  for (const id of derivedAchievements(eng.world, eng.simTime)) unlockAchievement(id)
}

/** boot 后立即应用昼夜光照：否则画布要等第一次 Ambient burst 才脱离默认亮光 */
function applyDayPhase(): void {
  if (!engine) return
  root.setDayPhase(engine.latestSnapshot().dayPhase)
  scheduler.invalidate()
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
        // 超前再锚定（M5 长期成立）：快进调试可能让模拟时间跑到墙钟之后，
        // 追赶会永久空转——整体平移回墙钟（所有时长语义不变），再走墙钟追赶
        const drift = reanchorSimTime(save.world, Date.now())
        if (drift > 0) {
          console.warn(`[sim] 模拟时间超前墙钟 ${Math.round(drift / DAY)} 天——已再锚定回当前时间`)
        }
        // 成就：恢复已解锁集合；游标指向历史末尾（历史事件不补发 toast）
        for (const id of save.appState?.achievements ?? []) unlockedAchievements.add(id)
        achievementCursor = events.length
        // 墙钟追赶 + 回拨保护（02 §1.2 / §1.4）
        const verdict = judgeWallDelta(save.lastWallSeen, Date.now())
        if (verdict.status === 'ok') {
          engine.advance(gridTarget(Date.now()), Number.MAX_SAFE_INTEGER)
        } else {
          console.warn('[sim] 检测到系统时钟回拨——本次会话模拟时间冻结')
        }
        console.info('[sim] 存档已恢复：sim =', new Date(engine.simTime).toLocaleString())
        sync()
        applyDayPhase()
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
  applyDayPhase()
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
  evaluateAchievements()
  checkpoint()
  if (journalOpen) renderJournal()
}, 30_000)

// M7-4 素材导出：SUCCULENT_TIMELAPSE 模式下主进程经 postMessage 驱动的单日推进。
// 未设环境变量时无人发此消息，零副作用；不落检查点（素材进程即弃）。
window.addEventListener('message', (e) => {
  // Electron webContents.postMessage 把通道名放在 e.channel；window.postMessage 则在 e.data
  const ch = (e as MessageEvent & { channel?: string }).channel
  if ((ch === 'succulent:advance-day' || e.data === 'succulent:advance-day') && engine) {
    engine.advance(engine.simTime + DAY, Number.MAX_SAFE_INTEGER)
    sync()
    scheduler.invalidate()
  }
})

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
        onWorldChanged: () => {
          sync()
          scheduler.invalidate()
          checkpoint()
        },
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

// M5-4 Journal：J 键时间线——消费事件日志，把"发生了什么"翻译成陪伴语言
const JOURNAL_TEXT: Record<string, string> = {
  'leaf.dropped': '一片叶子悄悄落下了',
  'leafgo.rooted': '落叶悄悄生根，新的生命开始了',
  'stretch.visible': '有点徒长——它在努力够阳光',
  'trunk.forming': '茎干开始木质化，老桩初成',
  'flower.withered': '花谢了，余韵还在',
  'flower.done': '花期结束了',
  'water.low': '土有点干了，记得看看它',
  'water.critical': '它很渴，快浇浇水吧',
  'water.recovered': '喝饱水，缓过来了',
  'sign.offset.occurred': '基部长出了小侧芽',
  'sign.flowerSpike.occurred': '花剑抽出来了！',
  'sign.droughtStruggle.occurred': '缺水让它有点撑不住',
}

const journal = document.createElement('div')
journal.className = 'journal-panel'
journal.style.display = 'none'
document.body.appendChild(journal)
let journalOpen = false

function closeJournal(): void {
  journalOpen = false
  journal.style.display = 'none'
}

function renderJournal(): void {
  const eng = engine
  if (!eng) return
  const moments = eng.events
    .filter((ev) =>
      ev.kind.startsWith('sign.')
        ? ev.kind.endsWith('.occurred') || ev.kind.endsWith('.critical')
        : ev.kind in JOURNAL_TEXT,
    )
    .slice(-60)
    .reverse()
  // 同类连续事件折叠（缺水等慢性事件会连发刷屏），只显示最近一条并计 ×N
  const collapsed: Array<{ kind: string; simTime: number; tier: string; count: number }> = []
  for (const ev of moments) {
    const top = collapsed[collapsed.length - 1]
    if (top && top.kind === ev.kind) {
      top.count++
    } else {
      collapsed.push({ kind: ev.kind, simTime: ev.simTime, tier: ev.tier, count: 1 })
    }
  }
  const pad = (n: number): string => String(n).padStart(2, '0')
  const rows = collapsed
    .map((m) => {
      const t = new Date(m.simTime)
      const time = `${t.getMonth() + 1}月${t.getDate()}日 ${pad(t.getHours())}:${pad(t.getMinutes())}`
      const text = (JOURNAL_TEXT[m.kind] ?? (m.kind.endsWith('.critical') ? '似乎有什么要发生了…' : m.kind)) + (m.count > 1 ? ` ×${m.count}` : '')
      return `<div class="j-row"><span class="j-dot tier-${m.tier}"></span><div><div class="j-text">${text}</div><div class="j-time">${time}</div></div></div>`
    })
    .join('')
  const unlockedCount = ACHIEVEMENT_DEFS.filter((d) => unlockedAchievements.has(d.id)).length
  const ach = ACHIEVEMENT_DEFS.map((d) =>
    unlockedAchievements.has(d.id)
      ? `<div class="j-ach-row"><span class="j-dot tier-major"></span><div><div class="j-text">🏆 ${d.title}</div><div class="j-time">${d.desc}</div></div></div>`
      : `<div class="j-ach-row locked"><span class="j-dot tier-micro"></span><div><div class="j-text">？？？</div><div class="j-time">${d.desc}</div></div></div>`,
  ).join('')
  journal.innerHTML =
    `<div class="j-head"><span>时间线 · ${collapsed.length} 条</span><button class="j-close" title="关闭">×</button></div>` +
    `<div class="j-list">` +
    (rows || '<div class="j-empty">还没有记录——陪伴它的日子，都会在这里留下痕迹</div>') +
    '</div>' +
    `<div class="j-ach-head">🏆 成就 ${unlockedCount}/${ACHIEVEMENT_DEFS.length}</div>` +
    `<div class="j-list">${ach}</div>` +
    '<div class="j-foot"><button data-j="seed">🌱 种子码</button><button data-j="import">导入</button></div>'
}

journal.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  if (t.classList.contains('j-close')) return closeJournal()
  const act = t.dataset?.j
  if (!act || !engine) return
  if (act === 'seed') {
    const p = engine.world.plants[0]
    if (!p) return
    // prompt 同时承担展示与复制（clipboard API 失败也不丢码）
    window.prompt(
      '种子码（聚焦后 Ctrl+C 复制，发给别人即可在他们的盆里重建这株）：',
      encodeSeedCode({ speciesId: p.speciesId, seed: p.seed, genome: p.genome }),
    )
  }
  if (act === 'import') {
    const raw = window.prompt('粘贴种子码：')
    if (!raw) return
    const decoded = decodeSeedCode(raw)
    if (!decoded) {
      toast('种子码无效（校验未通过）')
      return
    }
    const err = appendSeedling(engine.world.plants as unknown as SeedlingPlant[], decoded, engine.simTime)
    if (err) {
      toast(err)
      return
    }
    toast('🌱 一株新的多肉来到了你的盆里')
    sync()
    scheduler.invalidate()
    checkpoint()
    renderJournal()
  }
})

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && journalOpen) {
    closeJournal()
    return
  }
  if (e.code !== 'KeyJ' || e.shiftKey || e.repeat || !engine) return
  if (journalOpen) {
    closeJournal()
  } else {
    journalOpen = true
    journal.style.display = 'block'
    renderJournal()
  }
})

// M7-3 设置面板（S 键 / 托盘"设置"）：正式版用户设置入口
let passthroughWhenIdle = true
mountSettings({
  bridge,
  applyContentScale: (scale) => container.style.setProperty('zoom', String(scale)),
  applyPassthrough: (v) => {
    passthroughWhenIdle = v
  },
  toast,
})
void bridge.getSettings().then((s) => {
  container.style.setProperty('zoom', String(s.windowScale))
  passthroughWhenIdle = s.passthroughWhenIdle
})

// A3：PointerHitResolver 渲染侧——命中实体才接收鼠标，空白区穿透（forward 保持事件回流）
const hitTest = makeHitTester(root)

// A4：拖动生命周期交给主进程做屏幕坐标锚定；renderer 只报事件（rAF 节流 IPC）
let dragging = false
let moveQueued = false

// 指针是否落在 DOM 面板上（用包围盒而非 e.target：面板挂在 body 下，forward 事件的 target 不可靠）
function overRect(x: number, y: number, el: HTMLElement): boolean {
  if (el.style.display === 'none') return false
  const r = el.getBoundingClientRect()
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

function overSettings(x: number, y: number): boolean {
  const b = settingsBounds()
  return b !== null && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom
}

container.addEventListener('pointermove', (e) => {
  // DOM 面板（右键菜单/Journal/设置）悬停时保持接收鼠标，否则会被穿透
  const overPanel =
    overRect(e.clientX, e.clientY, journal) || overRect(e.clientX, e.clientY, menu) || overSettings(e.clientX, e.clientY)
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
  // M7-3：用户关闭空白穿透后整窗可交互（方便拖动/触控）
  bridge.setIgnoreMouseEvents(passthroughWhenIdle ? !overPanel && !hitTest(e.clientX, e.clientY) : false)
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

// M3-14：退出落盘的可见反馈——提示常驻到进程退出（约 1~2s），不做淡出
bridge.onFlushRequest(async () => {
  const hint = document.createElement('div')
  hint.className = 'saving-hint'
  hint.textContent = '🍃 正在保存…'
  document.body.appendChild(hint)
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
