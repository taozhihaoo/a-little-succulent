/**
 * SimEngine：接口 + InProcessSimEngine 实现（07 §2/§3）。
 * Worker 版将来只换传输：命令异步语义、快照缓存读（02 §3.3 / 07 §2）。
 * 确定性：RNG 按步派生（seed|simTime），与推进分片无关（I1，05 §3）。
 */
import { floorToGrid, SIM_STEP_MS } from '../clock'
import type { EventSink, SimEvent } from '../events'
import { derivePhenotype } from '../phenotype'
import type { PhenotypeSnapshot } from '../phenotype'
import type { Rng } from '../rng'
import { createRng } from '../rng'
import {
  GENERATOR_VERSION,
  SIMULATION_VERSION,
  SPECIES_VERSION,
  type SaveFile,
} from '../persist'
import { getSpecies } from '../species/registry'
import { simulateStep } from '../step'
import type { EnvConfig, InputEvent, PlantState, WorldState } from '../world'

export interface SimEngine {
  readonly simTime: number
  readonly world: Readonly<WorldState>

  /**
   * 推进到 targetSimTime（引擎内部先 floorToGrid，02 §1.2/1.3）。
   * 预算用步数而非 ms——sim 零计时 API（07 §3）；返回 done=false 表示还有余量未推完。
   */
  advance(targetSimTime: number, maxSteps: number): { done: boolean }

  /** 只入队，不立即改状态；下一个步边界结算（02 §1.3） */
  apply(input: InputEvent, opts?: { skipWal?: boolean }): void

  /** 渲染层唯一数据来源（缓存语义：随时可同步读取） */
  latestSnapshot(): PhenotypeSnapshot

  /** 检查点，不含几何（02 §6.1） */
  checkpoint(): SaveFile
}

/** 输入 WAL 抽象（02 §6.4）。进程内为同步 ack；真实文件持久化在主进程（07 §2）。 */
export interface InputWal {
  append(input: InputEvent): void
}

export interface InMemoryWal extends InputWal {
  entries(): readonly InputEvent[]
}

export function createInMemoryWal(): InMemoryWal {
  const entries: InputEvent[] = []
  return {
    append(input) {
      entries.push(input)
    },
    entries() {
      return entries
    },
  }
}

export interface EngineOptions {
  world: WorldState
  /** 恢复时带入：检查点之前的事件日志前缀（02 §6.4 载入流程） */
  events?: SimEvent[]
  wal?: InputWal
  /** 恢复时的序号水位（事件序号 = 前缀末尾；输入序号 = save.inputWalOffset） */
  eventSeq?: number
  inputSeq?: number
}

type QueuedInput = InputEvent

class InProcessSimEngine implements SimEngine {
  private readonly wal: InputWal | undefined
  private readonly _events: SimEvent[]
  private _eventSeq: number
  private _inputSeq: number
  private _pending: QueuedInput[] = []
  private snapshotCache: PhenotypeSnapshot | undefined

  constructor(
    private readonly _world: WorldState,
    opts: EngineOptions,
  ) {
    this.wal = opts.wal
    this._events = opts.events ?? []
    this._eventSeq = opts.eventSeq ?? 0
    this._inputSeq = opts.inputSeq ?? 0
  }

  get simTime(): number {
    return this._world.simTime
  }

  get world(): Readonly<WorldState> {
    return this._world
  }

  get events(): readonly SimEvent[] {
    return this._events
  }

  apply(input: InputEvent, opts?: { skipWal?: boolean }): void {
    const stamped: InputEvent = { ...input, seq: ++this._inputSeq }
    // 预写日志：确认（WAL 落盘 ack）后才允许在步边界结算（02 §6.4）
    if (!opts?.skipWal) this.wal?.append(stamped)
    this._pending.push(stamped)
  }

  advance(targetSimTime: number, maxSteps: number): { done: boolean } {
    const target = floorToGrid(targetSimTime)
    let steps = 0
    while (this._world.simTime < target && steps < maxSteps) {
      this.stepOnce()
      steps++
    }
    return { done: this._world.simTime >= target }
  }

  latestSnapshot(): PhenotypeSnapshot {
    const plant = this._world.plants[0]
    if (!plant) throw new Error('latestSnapshot: world has no plants')
    this.snapshotCache ??= derivePhenotype(plant, this._world.simTime, GENERATOR_VERSION, this._world.env)
    return this.snapshotCache
  }

  checkpoint(): SaveFile {
    return {
      formatVersion: 1,
      simulationVersion: SIMULATION_VERSION,
      speciesVersion: SPECIES_VERSION,
      generatorVersion: GENERATOR_VERSION,
      simTime: this._world.simTime,
      // TODO(M3)：宿主注入 WallTime 锚点并持久化（02 §1.2）
      lastWallSeen: 0,
      world: JSON.parse(JSON.stringify(this._world)) as WorldState,
      inputLogRef: 'inputs.jsonl',
      eventLogRef: 'events.jsonl',
      inputWalOffset: this._inputSeq,
      eventCount: this._events.length,
      appState: { scale: 1 },
    }
  }

  /** 推进一个逻辑步：结算 → 事件 → 网格推进（02 §2.1 / §1.3） */
  private stepOnce(): void {
    const w = this._world
    const stepStart = w.simTime // 恒在网格上（02 §1.3 不变量）

    const due = this._pending
      .filter((p) => p.simTime <= stepStart)
      .sort((a, b) => a.simTime - b.simTime || a.seq - b.seq)

    const sink: EventSink = (e) => {
      this._events.push({ ...e, seq: ++this._eventSeq })
    }
    // RNG 按步派生：与分片方式无关（连续 / 分片 / 重放得到同一序列，I1）
    const rng: Rng = createRng(`${w.plants[0]?.seed ?? 'world'}|${stepStart}`)

    simulateStep(w, SIM_STEP_MS, { rng, emit: sink, simTime: stepStart, inputs: due })

    if (due.length > 0) {
      const settled = new Set(due)
      this._pending = this._pending.filter((p) => !settled.has(p))
    }
    w.simTime = stepStart + SIM_STEP_MS
    this.snapshotCache = undefined
  }
}

export function createEngine(
  opts: EngineOptions,
): SimEngine & { readonly events: readonly SimEvent[] } {
  return new InProcessSimEngine(opts.world, opts)
}

/** 世界工厂：出生时刻向下对齐到网格；初始一株一叶；基因组由 seed 派生（I1）。 */
export function createWorld(seed: string, bornSimTime: number, env: EnvConfig): WorldState {
  const simTime = floorToGrid(bornSimTime)
  const plant: PlantState = {
    id: `plant-${seed}`,
    speciesId: 'echeveria',
    seed,
    genome: getSpecies('echeveria').createGenome(createRng(`${seed}|genome`)),
    bornSimTime,
    water: 0.9,
    stress: { light: 0, drought: 0, temp: 0 },
    stretch: 0,
    seasonPhase: 0,
    leaves: [
      ...[0.9, 0.75, 0.6, 0.45, 0.3].map((maturity, i) => ({
        bornSimTime: simTime - (5 - i) * 4 * 86_400_000,
        ringIndex: 0,
        maturity,
        turgor: 1,
        colorState: 0,
        damage: 0,
        rand: 0.2 + i * 0.15,
      })),
    ],
    stems: [{ heightMm: 8, lignification: 0 }],
    counters: {},
  }
  return {
    formatVersion: 1,
    simulationVersion: SIMULATION_VERSION,
    simTime,
    env,
    plants: [plant],
  }
}
