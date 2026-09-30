/** 事件流与预算（02 §2.3 / §2.4）。事件是唯一的事实记录（R12）。 */

export type EventTier = 'micro' | 'growth' | 'major'

export interface SimEvent {
  seq: number
  simTime: number
  plantId: string
  kind: string
  tier: EventTier
  /** 0~1 迹象强度（R5），随生命周期爬升 */
  signalStrength?: number
  payload?: unknown
}

export type EventSink = (event: Omit<SimEvent, 'seq'>) => void

/**
 * 事件预算（02 §2.4）：概率只允许发生在"条件满足"之后，超预算排队或丢弃。
 * TODO(M3)：预算随模拟内核实现；生命周期状态机属 M4（04 §12），不提前建。
 */
