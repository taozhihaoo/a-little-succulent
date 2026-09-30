/** 存档 schema（02 §6）。SaveFile 是磁盘持久化概念，≠ PlantState ≠ PhenotypeSnapshot（07 §0）。 */
import type { WorldState } from '../world'

export const SIMULATION_VERSION = 1
export const SPECIES_VERSION = 1
export const GENERATOR_VERSION = 1

export interface SaveFile {
  formatVersion: 1
  simulationVersion: number
  speciesVersion: number
  generatorVersion: number
  simTime: number
  lastWallSeen: number
  world: WorldState
  /** 输入 WAL 文件指针（inputs 移出存档，02 §6.4） */
  inputLogRef: string
  eventLogRef: string
  /** 检查点记录的 WAL 水位（02 §6.4）：恢复时只重放 seq 大于它的输入 */
  inputWalOffset: number
  appState: {
    windowBounds?: { x: number; y: number; width: number; height: number }
    scale: number
  }
}

/** 存档不含任何不可 JSON 化的对象（02 §6.1），因此序列化就是 JSON。 */
export function serializeSave(save: SaveFile): string {
  return JSON.stringify(save)
}

export function parseSave(json: string): SaveFile {
  return JSON.parse(json) as SaveFile
}
