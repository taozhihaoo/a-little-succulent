/**
 * M6-1 杂交遗传。
 * 受粉前提是父本正在开花（spike=true → 花粉存在）；父本取同盆开花株中活叶最多者
 *（平局取序靠前者，确定性）。子代每个基因座 50/50 取双亲之一；无可选父本时退化为
 * 克隆母株（与 M4/M5 行为一致，规则见 06 日志）。
 */
import type { Rng } from '../rng'
import type { Genome, PlantState } from '../world'

export interface OffspringGenetics {
  genome: Genome
  /** 杂交父本 id（克隆 = undefined） */
  fatherId?: string
}

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

/** 子代基因组：杂交 = 基因座 50/50 混合（单亲缺失的座位取有值一方）；克隆 = 复制母株。 */
export function offspringGenetics(mother: PlantState, father: PlantState | undefined, rng: Rng): OffspringGenetics {
  if (!father) return { genome: { values: { ...mother.genome.values } } }
  const values: Record<string, number> = {}
  const names = new Set([...Object.keys(mother.genome.values), ...Object.keys(father.genome.values)])
  for (const name of names) {
    const a = mother.genome.values[name]
    const b = father.genome.values[name]
    values[name] = a === undefined ? b! : b === undefined ? a : rng() < 0.5 ? a : b
  }
  return { genome: { values }, fatherId: father.id }
}
