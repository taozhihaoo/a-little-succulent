/** 世界状态类型（02 §3）。字段是模拟的唯一真相；渲染只读 PhenotypeSnapshot（07 §0）。 */
import type { SignState } from '../signs'

export type SpeciesId = 'echeveria'

export interface EnvConfig {
  /** 摆放位（总方案 §45） */
  placement: 'windowsill' | 'table-center' | 'lamp' | 'shade'
  /** 本地性参数进入模拟：utcOffset（02 §2.2），变更写成输入事件 */
  utcOffsetMinutes: number
  /** 南北半球影响季节相位（02 §2.2） */
  hemisphere: 'north' | 'south'
}

export interface InputEvent {
  seq: number
  /** 输入发生时刻；在 nextBoundary(simTime) 步头结算（02 §1.3） */
  simTime: number
  type: string
  payload?: unknown
}

export interface LeafState {
  bornSimTime: number
  ringIndex: number
  /** 0~1 */
  maturity: number
  /** 0~1 饱满度 */
  turgor: number
  /** 0~1 应激色量 */
  colorState: number
  damage: number
  /** 出生时由确定性 RNG 派生的个体随机量（叶序抖动等） */
  rand: number
  droppedSimTime?: number
}

export interface StemState {
  heightMm: number
  /** 0~1 木质化程度（老桩，M5） */
  lignification: number
}

export interface Genome {
  /** 0~1 归一化基因，生效范围由 species 定义约束（总方案 §10） */
  values: Record<string, number>
}

export interface PlantState {
  id: string
  speciesId: SpeciesId
  /** 随机种子（序列化用字符串），创建时由 CSPRNG 生成（02 §3.2） */
  seed: string
  genome: Genome
  bornSimTime: number
  /** 0~1 植株级水分 */
  water: number
  stress: { light: number; drought: number; temp: number }
  /** 徒长程度 0~1 */
  stretch: number
  seasonPhase: number
  leaves: LeafState[]
  stems: StemState[]
  counters: Record<string, number>
  signs?: SignState[]
}

export interface WorldState {
  formatVersion: 1
  simulationVersion: number
  simTime: number
  env: EnvConfig
  plants: PlantState[]
}
