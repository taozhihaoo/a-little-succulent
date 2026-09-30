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

// A4：拖动生命周期交给主进程做屏幕坐标锚定；renderer 只报事件（rAF 节流 IPC）
let dragging = false
let moveQueued = false

container.addEventListener('pointermove', (e) => {
  if (dragging) {
    if (moveQueued) return
    moveQueued = true
    requestAnimationFrame(() => {
      moveQueued = false
      if (dragging) bridge.dragMove()
    })
    return
  }
  bridge.setIgnoreMouseEvents(!hitTest(e.clientX, e.clientY))
})

container.addEventListener('pointerdown', (e) => {
  if (hitTest(e.clientX, e.clientY)) {
    dragging = true
    bridge.dragStart()
    container.setPointerCapture(e.pointerId)
  }
})

function endDrag(): void {
  if (dragging) {
    dragging = false
    bridge.dragEnd()
  }
}

container.addEventListener('pointerup', endDrag)
container.addEventListener('pointercancel', endDrag)

console.info('[renderer] up; bridge =', bridge?.version ?? 'none')
