/**
 * render 包骨架（07 §4）。
 * 规则：渲染层只读 PhenotypeSnapshot，永不反推植物状态；画的时机只归 RenderScheduler。
 * M1：占位球退休，场景为 mm 尺度的真实莲座（PlantRenderer）。
 */
import * as THREE from 'three'

export type RenderPhase = 'DeepIdle' | 'Ambient' | 'Active'

export interface SceneRoot {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  dispose(): void
}

/** 场景骨架：相机/光照按 mm 尺度布置；植物与花盆由 PlantRenderer 提供。 */
export function createSceneRoot(container: HTMLElement): SceneRoot {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight, false)
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 2000)
  camera.position.set(0, 70, 175)
  camera.lookAt(0, 22, 0)

  const key = new THREE.DirectionalLight(0xffffff, 2.4)
  key.position.set(120, 180, 150)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6)
  fill.position.set(-100, 60, -80)
  scene.add(fill)
  scene.add(new THREE.AmbientLight(0xffffff, 0.65))

  const onResize = () => {
    const w = container.clientWidth
    const h = container.clientHeight
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(onResize)
  observer.observe(container)

  return {
    renderer,
    scene,
    camera,
    dispose() {
      observer.disconnect()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

/**
 * 渲染三态状态机（02 §4 / R1）——唯一决定"何时画"。
 *
 * Deep Idle：不渲染、无 RAF（前台全屏 / 最小化时由外部强制进入，A13 接线）。
 * Ambient：常驻生命感——每 3~10 秒触发一段 0.5~2 秒的微动画 burst，播完停帧；
 *          可见状态变化用 invalidate() 强制渲染 1 帧。
 * Active：指针在窗口内 / 拖动 / 事件回放期间连续 RAF。
 */
const AMBIENT_MIN_GAP_MS = 3_000
const AMBIENT_MAX_GAP_MS = 10_000
const BURST_MIN_MS = 500
const BURST_MAX_MS = 2_000
const SWAY_AMPLITUDE = 0.002
/** Ambient burst 帧率上限：透明置顶窗口每帧都有 DWM 合成成本（A9 实测后加） */
const AMBIENT_FRAME_INTERVAL_MS = 1000 / 30

export class RenderScheduler {
  phase: RenderPhase = 'Active'

  private readonly root: SceneRoot
  private rafId = 0
  private ambientTimer: ReturnType<typeof setTimeout> | undefined
  private burstStart = 0
  private burstUntil = 0
  private burstLastRender = 0
  private readonly tick: (timeMs: number) => void

  constructor(root: SceneRoot) {
    this.root = root
    this.tick = (timeMs: number) => {
      this.rafId = 0
      if (this.phase === 'DeepIdle') return

      if (this.phase === 'Active') {
        // TODO(M1 收尾): 仅在快照变化时渲染（on-demand），而非每帧
        this.root.renderer.render(this.root.scene, this.root.camera)
        this.rafId = requestAnimationFrame(this.tick)
        return
      }

      // Ambient：burst 内做微小摆动（帧率上限 30fps），结束后归位停帧并排下一次 burst
      if (timeMs < this.burstUntil) {
        const elapsed = timeMs - this.burstLastRender
        if (elapsed < AMBIENT_FRAME_INTERVAL_MS) {
          this.rafId = requestAnimationFrame(this.tick)
          return
        }
        this.burstLastRender = timeMs
        const t = (timeMs - this.burstStart) / 1000
        this.root.scene.rotation.z = Math.sin(t * 1.6) * SWAY_AMPLITUDE
        this.root.renderer.render(this.root.scene, this.root.camera)
        this.rafId = requestAnimationFrame(this.tick)
      } else {
        this.root.scene.rotation.z = 0
        this.root.renderer.render(this.root.scene, this.root.camera)
        this.scheduleNextBurst()
      }
    }
  }

  start(): void {
    // 注意：不走 setPhase——phase 初始值就是 'Active'，会命中"同相位"短路导致 RAF 永不启动
    this.phase = 'Active'
    this.ensureRaf()
  }

  setPhase(phase: RenderPhase): void {
    if (phase === this.phase) {
      if (phase === 'Active') this.ensureRaf()
      return
    }
    this.phase = phase
    if (this.ambientTimer !== undefined) {
      clearTimeout(this.ambientTimer)
      this.ambientTimer = undefined
    }
    switch (phase) {
      case 'DeepIdle':
        if (this.rafId !== 0) cancelAnimationFrame(this.rafId)
        this.rafId = 0
        break
      case 'Ambient':
        this.scheduleNextBurst()
        break
      case 'Active':
        this.ensureRaf()
        break
    }
  }

  /** 可见状态变化（新叶 / 变色跨档）强制渲染至少 1 帧（02 §4） */
  invalidate(): void {
    if (this.phase === 'DeepIdle') {
      this.root.renderer.render(this.root.scene, this.root.camera)
      return
    }
    if (this.phase === 'Ambient' && this.rafId === 0) {
      this.root.renderer.render(this.root.scene, this.root.camera)
    }
  }

  private ensureRaf(): void {
    if (this.rafId === 0) this.rafId = requestAnimationFrame(this.tick)
  }

  private scheduleNextBurst(): void {
    if (this.ambientTimer !== undefined) return
    const gap = AMBIENT_MIN_GAP_MS + Math.random() * (AMBIENT_MAX_GAP_MS - AMBIENT_MIN_GAP_MS)
    this.ambientTimer = setTimeout(() => {
      this.ambientTimer = undefined
      if (this.phase !== 'Ambient') return
      this.burstStart = performance.now()
      this.burstUntil =
        this.burstStart + BURST_MIN_MS + Math.random() * (BURST_MAX_MS - BURST_MIN_MS)
      this.ensureRaf()
    }, gap)
  }
}

/**
 * 命中测试助手（PointerHitResolver 的渲染侧输入，A3）：
 * 屏幕坐标 → 是否命中实体（raycast）。穿透切换在 desktop 层做（07 §5）。
 */
export function makeHitTester(root: SceneRoot): (clientX: number, clientY: number) => boolean {
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const meshes: THREE.Mesh[] = []
  root.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
  })

  return (clientX, clientY) => {
    const rect = root.renderer.domElement.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(ndc, root.camera)
    return raycaster.intersectObjects(meshes, false).length > 0
  }
}

export { buildLeafGeometry, type LeafShapeParams } from './leaf'
export { PlantRenderer } from './plant'
