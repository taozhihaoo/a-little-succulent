/** 存档 schema（02 §6）。SaveFile 是磁盘持久化概念，≠ PlantState ≠ PhenotypeSnapshot（07 §0）。 */
import type { WorldState } from '../world'

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
  appState: {
    windowBounds?: { x: number; y: number; width: number; height: number }
    scale: number
  }
}
