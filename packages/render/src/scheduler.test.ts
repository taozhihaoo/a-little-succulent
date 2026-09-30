/** 渲染调度器回归测试：start() 必须真正启动 RAF（"透明窗口永不绘制"事故的防线）。 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { RenderScheduler } from './index'
import type { SceneRoot } from './index'

function makeFakeRoot(): SceneRoot {
  return {
    renderer: { render: () => undefined } as unknown as THREE.Renderer,
    scene: { rotation: { z: 0 } } as unknown as THREE.Scene,
    camera: {} as THREE.Camera,
    dispose: () => undefined,
  }
}

describe('RenderScheduler（A9）', () => {
  it('start() 必须调度第一帧（RAF 永不启动 = 透明窗口永不绘制）', () => {
    const original = globalThis.requestAnimationFrame
    let scheduled = 0
    ;(globalThis as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = ((
      cb: (time: number) => void,
    ) => {
      scheduled++
      void cb
      return scheduled
    }) as typeof requestAnimationFrame

    try {
      const scheduler = new RenderScheduler(makeFakeRoot())
      scheduler.start()
      expect(scheduled).toBeGreaterThan(0)
    } finally {
      globalThis.requestAnimationFrame = original
    }
  })
})
