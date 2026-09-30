/** SimEngine 接口（07 §3）。实现属 S2/M3：命令异步语义、快照缓存读、步数预算。 */
import type { InputEvent, WorldState } from '../world'
import type { PhenotypeSnapshot } from '../phenotype'
import type { SaveFile } from '../persist'

export interface SimEngine {
  readonly simTime: number
  readonly world: Readonly<WorldState>

  /**
   * 推进到 targetSimTime（引擎内部先 floorToGrid，02 §1.2/1.3）。
   * 预算用步数而非 ms——sim 零计时 API（07 §3）；返回 done=false 表示还有余量未推完。
   */
  advance(targetSimTime: number, maxSteps: number): { done: boolean }

  /** 只入队，不立即改状态；下一个步边界结算（02 §1.3） */
  apply(input: InputEvent): void

  /** 渲染层唯一数据来源（缓存语义：随时可同步读取） */
  latestSnapshot(): PhenotypeSnapshot

  /** 检查点，不含几何（02 §6.1） */
  checkpoint(): SaveFile
}
