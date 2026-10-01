/**
 * M6-1 杂交遗传 / M6-2 稀有突变。
 * 受粉前提是父本正在开花（spike=true → 花粉存在）；父本取同盆开花株中活叶最多者
 *（平局取序靠前者，确定性）。子代每个基因座 50/50 取双亲之一；无可选父本时退化为
 * 克隆母株（与 M4/M5 行为一致，规则见 06 日志）。
 * 突变：子代创建时未表达的稀有座位独立低概率翻转为显性——"未知变化"的核心体验。
 */
import type { Rng } from '../rng'
import type { Genome, PlantState } from '../world'

export interface OffspringGenetics {
  genome: Genome
  /** 杂交父本 id（克隆 = undefined） */
  fatherId?: string
  /** 本次发生的突变座位（空 = 无突变） */
  mutations: string[]
}

/** 稀有座位 → 显性表达值。已达表达阈值的座位不再掷（不会突变回隐性）。 */
const RARE_LOCI: Record<string, number> = { variegata: 0.85, cristata: 0.85 }
/** 每座位每子代的突变概率（约 1/50 苗·座位——稀有但要遇得到） */
export const MUTATION_CHANCE = 0.02
/** 显性表达阈值：基因 ≥ 0.5 视为表达（形态/渲染读同一阈值） */
export const RARE_EXPRESS_THRESHOLD = 0.5

/** 父本选择：同盆正在开花的植株中活叶最多者（确定性）。没有开花株 → undefined（克隆）。 */
export function pickFather(plants: readonly PlantState[], mother: PlantState): PlantState | undefined {
  let best: PlantState | undefined
  let bestLeaves = 0
  for (const p of plants) {
    if (p.id === mother.id || !p.spike) continue
    const n = p.leaves.filter((l) => l.droppedSimTime === undefined).length
    if (n > bestLeaves) {
      best = p
      bestLeaves = n
    }
  }
  return best
}

/** 子代基因组：杂交 = 基因座 50/50 混合（单亲缺失的座位取有值一方）；克隆 = 复制母株。之后掷稀有突变。 */
export function offspringGenetics(mother: PlantState, father: PlantState | undefined, rng: Rng): OffspringGenetics {
  let values: Record<string, number>
  if (!father) {
    values = { ...mother.genome.values }
  } else {
    values = {}
    const names = new Set([...Object.keys(mother.genome.values), ...Object.keys(father.genome.values)])
    for (const name of names) {
      const a = mother.genome.values[name]
      const b = father.genome.values[name]
      values[name] = a === undefined ? b! : b === undefined ? a : rng() < 0.5 ? a : b
    }
  }
  const genome: Genome = { values }
  const mutations: string[] = []
  for (const [locus, expressed] of Object.entries(RARE_LOCI)) {
    if ((values[locus] ?? 0) >= RARE_EXPRESS_THRESHOLD) continue
    if (rng() < MUTATION_CHANCE) {
      values[locus] = expressed
      mutations.push(locus)
    }
  }
  return { genome, fatherId: father?.id, mutations }
}
