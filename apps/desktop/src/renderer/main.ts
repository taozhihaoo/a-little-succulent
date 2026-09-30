import { makeHitTester, RenderScheduler, createSceneRoot } from '@succulent/render'
import './style.css'

const container = document.getElementById('app')
if (!container) throw new Error('#app not found')

const bridge = window.succulent
const root = createSceneRoot(container)
const scheduler = new RenderScheduler(root)
scheduler.start()

// A3：PointerHitResolver 渲染侧——命中实体才接收鼠标，空白区穿透（forward 保持事件回流）
const hitTest = makeHitTester(root)

// A4：IPC 手动拖动（07 §5；禁用 CSS drag region）
let dragging = false
let lastX = 0
let lastY = 0

container.addEventListener('pointermove', (e) => {
  if (dragging) {
    bridge.dragWindow(e.clientX - lastX, e.clientY - lastY)
    lastX = e.clientX
    lastY = e.clientY
    return
  }
  bridge.setIgnoreMouseEvents(!hitTest(e.clientX, e.clientY))
})

container.addEventListener('pointerdown', (e) => {
  if (hitTest(e.clientX, e.clientY)) {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    container.setPointerCapture(e.pointerId)
  }
})

container.addEventListener('pointerup', () => {
  dragging = false
})

console.info('[renderer] up; bridge =', bridge?.version ?? 'none')
