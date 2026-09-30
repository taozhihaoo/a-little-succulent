/**
 * render 包骨架（07 §4）。
 * 规则：渲染层只读 PhenotypeSnapshot，永不反推植物状态；画的时机只归 RenderScheduler。
 * 占位场景用于 M0 的 A1/A2（透明窗口 + alpha 边缘检查），M1 才替换为程序化莲座。
 */
import * as THREE from 'three'

export type RenderPhase = 'DeepIdle' | 'Ambient' | 'Active'

export interface SceneRoot {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  dispose(): void
}

/** 占位场景：一个"盆 + 绿球"，足够验证透明窗口与 alpha 边缘（05 A1/A2）。 */
export function createSceneRoot(container: HTMLElement): SceneRoot {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(container.clientWidth, container.clientHeight, false)
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
  camera.position.set(0, 1.4, 4.2)
  camera.lookAt(0, 0.5, 0)

  const key = new THREE.DirectionalLight(0xffffff, 2.4)
  key.position.set(2, 3, 2.5)
  scene.add(key)
  scene.add(new THREE.AmbientLight(0xffffff, 0.7))

  // 占位"多肉"（M1 由 PlantRenderer 消费 PhenotypeSnapshot 替换）
  const placeholder = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.85, 2),
    new THREE.MeshStandardMaterial({ color: 0x7da87b, roughness: 0.55, flatShading: false }),
  )
  placeholder.position.y = 1.0
  scene.add(placeholder)

  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.75, 0.55, 0.8, 40),
    new THREE.MeshStandardMaterial({ color: 0xb5654a, roughness: 0.9 }),
  )
  pot.position.y = 0.4
  scene.add(pot)

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
 * 渲染三态状态机（02 §4 / R1）。
 * TODO(A9)：DeepIdle 停帧、Ambient 按需短动画（每 3~10 秒 0.5~2 秒 burst）、
 * 指针/事件唤醒与全屏检测联动。M0 骨架先以 Active 连续帧验证管线。
 */
export class RenderScheduler {
  phase: RenderPhase = 'Active'

  private readonly root: SceneRoot
  private rafId = 0
  private readonly tick: (timeMs: number) => void

  constructor(root: SceneRoot) {
    this.root = root
    this.tick = (timeMs: number) => {
      if (this.phase === 'DeepIdle') return
      // TODO(M1): 消费 PhenotypeSnapshot 更新网格与 shader 参数（快照间插值）
      this.root.renderer.render(this.root.scene, this.root.camera)
      this.rafId = requestAnimationFrame(this.tick)
      void timeMs
    }
  }

  start(): void {
    this.phase = 'Active'
    this.rafId = requestAnimationFrame(this.tick)
  }

  setPhase(phase: RenderPhase): void {
    this.phase = phase
    if (phase === 'DeepIdle') cancelAnimationFrame(this.rafId)
    else if (this.rafId === 0) this.rafId = requestAnimationFrame(this.tick)
  }
}

/**
 * 命中测试助手（PointerHitResolver 的渲染侧输入，A3）：
 * 屏幕坐标 → 是否命中实体（代理网格 raycast）。穿透切换在 desktop 层做（07 §5）。
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
