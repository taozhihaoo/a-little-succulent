/** 单步结算（02 §2.1）。固定顺序，不可重排；确定性由 S2 回归测试钉住（05 §3）。 */
import type { Rng } from '../rng'
import type { InputEvent, WorldState } from '../world'
import type { EventSink } from '../events'

export interface StepCtx {
  rng: Rng
  emit: EventSink
  /** 落入当前步的已确认输入（下一个步边界结算，02 §1.3） */
  inputs: readonly InputEvent[]
}

export interface StepResult {
  eventsEmitted: number
}

/** 推进一个逻辑步（SIM_STEP_MS）。内部顺序见 02 §2.1，禁止重排。 */
export function simulateStep(world: WorldState, dtMs: number, ctx: StepCtx): StepResult {
  void world
  void dtMs
  void ctx
  throw new Error('simulateStep: S2 落地（05 §3）')
}
