/**
 * M6-4 成就（事件驱动）：定义表 + 事件匹配 + 世界派生条件。
 * 解锁持久化在存档 appState.achievements；M7 接入 Steamworks 后 unlock 换成
 * SteamAdapter.SetAchievement（本表的事件→成就映射保持不变）。
 */

export interface AchievementDef {
  id: string
  title: string
  desc: string
  /** 匹配的 sim 事件 kind；以 '.' 结尾视为前缀匹配（如 'mutate.'） */
  event?: string
}

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { id: 'first-leaf-fall', title: '初次的告别', desc: '见证第一片叶子落下', event: 'leaf.dropped' },
  { id: 'new-life', title: '失去之后', desc: '一片落叶悄悄生了根', event: 'leafgo.rooted' },
  { id: 'generations', title: '代的传承', desc: '两株植株杂交出了子代', event: 'cross.bred' },
  { id: 'unknown-gift', title: '未知的礼物', desc: '子代发生了稀有突变', event: 'mutate.' },
  { id: 'first-spike', title: '花芽初现', desc: '花剑抽出来了', event: 'sign.flowerSpike.occurred' },
  { id: 'full-bloom', title: '盛放与谢幕', desc: '陪它走过一个完整花期', event: 'flower.done' },
  { id: 'old-trunk', title: '老桩养成', desc: '茎干开始木质化', event: 'trunk.forming' },
  { id: 'thrived-100', title: '一百天', desc: '同一株多肉陪伴了一百天' },
]

/** 事件 → 成就 id 列表（精确或前缀匹配） */
export function achievementsForEvent(kind: string): string[] {
  return ACHIEVEMENT_DEFS.filter((d) => d.event !== undefined && (d.event === kind || (d.event.endsWith('.') && kind.startsWith(d.event)))).map((d) => d.id)
}

/** 世界派生条件（随检查点评估）：苗龄 100 天等 */
export function derivedAchievements(world: { plants: readonly { bornSimTime: number }[] }, simTime: number): string[] {
  const out: string[] = []
  const main = world.plants[0]
  if (main && simTime - main.bornSimTime >= 100 * 86_400_000) out.push('thrived-100')
  return out
}
