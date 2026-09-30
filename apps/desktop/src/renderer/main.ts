import { createSceneRoot, RenderScheduler } from '@succulent/render'
import './style.css'

const container = document.getElementById('app')
if (!container) throw new Error('#app not found')

const root = createSceneRoot(container)
const scheduler = new RenderScheduler(root)
scheduler.start()

// TODO(A3)：PointerHitResolver 判定命中，动态切换 setIgnoreMouseEvents
// TODO(A4)：按住拖动 → IPC 手动移动窗口（07 §5，禁用 CSS drag region）
console.info('[renderer] up; bridge =', window.succulent?.version ?? 'none')
