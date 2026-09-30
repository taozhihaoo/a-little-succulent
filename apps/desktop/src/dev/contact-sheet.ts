/**
 * 100 株联系表（03 §7 / 总方案 §41.4）——M1 验收工具，仅 DEV 构建。
 * 批量生成 N 株不同基因的固定苗龄植株，网格排布；Shift+S 导出 PNG，Esc 退出。
 * 唯一性粗检：控制台输出叶数 min/max/avg（数值指标版属 M5，R14）。
 */
import * as THREE from 'three'
import { createEngine, createWorld } from '@succulent/sim'
import { PlantRenderer, type SceneRoot } from '@succulent/render'
import type { DesktopBridge } from '../shared/protocol'

const DAY = 86_400_000
const COLS = 10
const COUNT = 100
const SPACING = 160 // mm
const AGE_DAYS = 60

const ENV = {
  placement: 'windowsill',
  utcOffsetMinutes: 480,
  hemisphere: 'north',
} as const

export function mountContactSheet(
  root: SceneRoot,
  widget: PlantRenderer,
  bridge: DesktopBridge,
): () => void {
  widget.group.visible = false
  bridge.setBounds(1440, 1000)

  // 相机：俯视 10×10 网格；退出时恢复挂件机位（createSceneRoot 的默认值）
  const cam = root.camera
  cam.position.set(0, 1500, 1900)
  cam.lookAt(0, 40, 0)

  const grid = new THREE.Group()
  root.scene.add(grid)

  let leafMin = Number.POSITIVE_INFINITY
  let leafMax = 0
  let leafSum = 0
  const renderers: PlantRenderer[] = []

  for (let i = 0; i < COUNT; i++) {
    const world = createWorld(`sheet-${String(i).padStart(3, '0')}`, 0, ENV)
    const engine = createEngine({ world })
    engine.advance(AGE_DAYS * DAY, Number.MAX_SAFE_INTEGER)

    const pr = new PlantRenderer(grid)
    const col = i % COLS
    const row = Math.floor(i / COLS)
    pr.group.position.set((col - (COLS - 1) / 2) * SPACING, 0, (row - (COLS - 1) / 2) * SPACING)
    const snap = engine.latestSnapshot()
    pr.update(snap)
    renderers.push(pr)

    const n = snap.organs.length
    leafMin = Math.min(leafMin, n)
    leafMax = Math.max(leafMax, n)
    leafSum += n
  }

  root.renderer.render(root.scene, root.camera)
  console.info(
    `[contact] ${COUNT} plants @ ${AGE_DAYS}d; leaves min=${leafMin} max=${leafMax} avg=${(leafSum / COUNT).toFixed(1)}`,
  )

  const onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'KeyS' || !e.shiftKey) return
    root.renderer.render(root.scene, root.camera)
    const url = root.renderer.domElement.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = `contact-sheet-${COUNT}plants-${AGE_DAYS}d.png`
    a.click()
  }
  window.addEventListener('keydown', onKey)

  return () => {
    window.removeEventListener('keydown', onKey)
    root.scene.remove(grid)
    for (const pr of renderers) pr.dispose()
    widget.group.visible = true
    cam.position.set(0, 70, 175)
    cam.lookAt(0, 22, 0)
    bridge.setBounds(380, 460)
    root.renderer.render(root.scene, root.camera)
  }
}
