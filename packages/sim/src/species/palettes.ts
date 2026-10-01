/** 品种色板系统（M4 任务 8 / docs/08 §2.2）：五系基/尖色板（0~1 RGB） */

export interface VarietyPalette {
  id: string
  /** 中文名（Journal/Console 显示用） */
  label: string
  base: [number, number, number]
  /** 叶尖/应激色 */
  tip: [number, number, number]
}

export const ECHEVERIA_PALETTES: VarietyPalette[] = [
  // 粉：绿基粉尖（胭脂系）
  { id: 'pink', label: '胭脂', base: [0.42, 0.62, 0.36], tip: [0.96, 0.72, 0.78] },
  // 橙红：深绿基橙红尖（红颜系）
  { id: 'orange', label: '红颜', base: [0.30, 0.52, 0.30], tip: [0.94, 0.52, 0.30] },
  // 白粉：灰绿基白粉尖（晚樱系）
  { id: 'white', label: '晚樱', base: [0.55, 0.62, 0.50], tip: [0.97, 0.93, 0.90] },
  // 红：绿基红尖白缘（杨贵妃系）
  { id: 'red', label: '杨贵妃', base: [0.36, 0.55, 0.32], tip: [0.88, 0.30, 0.34] },
  // 黄绿：黄绿基明黄尖（蕉姿系）
  { id: 'yellow', label: '蕉姿', base: [0.55, 0.66, 0.30], tip: [0.96, 0.88, 0.42] },
]

/** palette 基因（0~1）→ 色板索引（绚丽向：wDay 权重拉高饱和的表现交给 leaf-material） */
export function paletteFor(gene: number): VarietyPalette {
  const idx = Math.min(ECHEVERIA_PALETTES.length - 1, Math.max(0, Math.floor(gene * ECHEVERIA_PALETTES.length)))
  return ECHEVERIA_PALETTES[idx]!
}
