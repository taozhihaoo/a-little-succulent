/** SpeciesDef（07 §3）：引擎不认识具体植物；M1～M5 只有 echeveria（R10）。 */
import type { Genome, PlantState } from '../world'
import type { EnvSample } from '../env'
import type { Rng } from '../rng'
import type { StepCtx } from '../step'

/** 植物学语义姿态（render-neutral，02 §3.3）：不是引擎 Transform */
export interface OrganPose {
  ring: number
  /** 相对竖直的倾角（弧度） */
  tilt: number
  /** 方位角（弧度） */
  azimuth: number
  /** 叶基距中心的偏移（mm） */
  offset: number
  /** 老化 / 缺水垂头附加量（弧度） */
  droop: number
  /** 纵向卷曲 0~1 */
  curl: number
  /** 生长进度 0~1 */
  growth: number
  length: number
  width: number
  thickness: number
  /** 0~1 应激色量（M2：渲染侧叶尖渐变强度） */
  colorState: number
  /** 0~1 饱满度（M2：影响透光/光泽） */
  turgor: number
}

export * from './echeveria'

export interface SpeciesDef {
  id: string
  /** = speciesVersion（02 §6.1） */
  version: number
  createGenome(rng: Rng, baseTable?: Record<string, number>): Genome
  growStep(plant: PlantState, env: EnvSample, dtMs: number, ctx: StepCtx): void
  /** 生长语法：由状态派生全部器官姿态（总方案 §11.2） */
  morphology(plant: PlantState): OrganPose[]
}
