/**
 * M7 Steamworks 接入（steamworks.js）：成就激活 + Remote Storage 云存档。
 * 全链路安全降级：未打包 / 未运行 Steam / 无 steam_appid.txt → getSteam() 返回 null，
 * 成就走本地 appState、云存档回退 LocalCloudAdapter——语义与既有行为完全一致。
 * steam_appid.txt 打包时置于 exe 旁即可用真实 AppID；上架前由 Steamworks 配置驱动。
 */
import steamworks from 'steamworks.js'

export interface SteamBridge {
  playerName(): string | null
  /** 激活 Steam 成就（id 与 Steamworks 后台配置同名）；失败返回 false */
  unlockAchievement(id: string): boolean
  /** Remote Storage 三件套读写（SteamCloudAdapter 用）；全部吃异常转空值 */
  readFile(name: string): string | null
  writeFile(name: string, content: string): boolean
  deleteFile(name: string): void
  listFiles(): string[]
}

let cached: SteamBridge | null | undefined

export function getSteam(): SteamBridge | null {
  if (cached !== undefined) return cached
  try {
    const client = steamworks.init()
    const bridge: SteamBridge = {
      playerName: () => {
        try {
          return client.localplayer.getName()
        } catch {
          return null
        }
      },
      unlockAchievement: (id) => {
        try {
          client.achievement.activate(id)
          return true
        } catch {
          return false
        }
      },
      readFile: (name) => {
        try {
          return client.cloud.readFile(name)
        } catch {
          return null
        }
      },
      writeFile: (name, content) => {
        try {
          return client.cloud.writeFile(name, content)
        } catch {
          return false
        }
      },
      deleteFile: (name) => {
        try {
          client.cloud.deleteFile(name)
        } catch {
          // 忽略：远端不存在等同已删除
        }
      },
      listFiles: () => {
        try {
          return client.cloud.listFiles().map((f) => f.name)
        } catch {
          return []
        }
      },
    }
    console.info('[steam] 已接入:', bridge.playerName() ?? '(匿名)')
    cached = bridge
  } catch (err) {
    console.info('[steam] 不可用——成就/云存档降级本地:', String(err).slice(0, 80))
    cached = null
  }
  return cached
}
