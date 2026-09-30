# ARCHITECTURE.md · AI 工程契约卡

> 给 AI 的最小上下文：改任何模块前先读这一页。细节查 `docs/02`（模拟领域设计）与 `docs/07`（代码结构）。
> **纪律：接口一变，必须同步更新本页与 docs/07。**

---

## 不变量（违反即 bug）

1. **确定性**：Seed + 输入序列 + simulationVersion ⇒ 逐字节相同的状态与事件流
2. **分层**：`sim` 禁 import three / electron / DOM / Node；渲染只读快照，永不反推植物状态
3. **时间单调**：SimulationTime 只前进；sim 内禁止读取当前时间（`Date.now` / `new Date()` / `performance`），时间一律外部注入
4. **无逐秒 tick**：一切模拟 = 整步批量结算；simTime 永远落在步网格 `[k·Δ, (k+1)·Δ)` 上
5. **存档是状态不是几何**：`PlantState` ≠ `PhenotypeSnapshot` ≠ `SaveFile`，三者永不混淆
6. **版本钉扎**：旧存档按其 simulationVersion 解释，禁止隐式重算

## 依赖（CI 强制）

```text
sim ← render ← desktop        （sim 零运行时依赖）
sim    ↛ render / electron / DOM ❌
render ↛ electron / main        ❌
```

## 核心接口

```ts
SimEngine.advance(targetSimTime, maxSteps)  // 步数预算，不是 ms；引擎内部 floorToGrid
SimEngine.apply(input)                      // 只入队，下一个步边界结算
SimEngine.latestSnapshot()                  // 渲染唯一数据源（缓存读，同步）
SpeciesDef { createGenome / growStep / morphology(): OrganPose[] }
PointerHitResolver: 屏幕坐标 → Ignore | Hover | Interact | Drag | Menu
```

## 纪律

* 画的时机只归 RenderScheduler（三态：Deep Idle / Ambient 按需短动画 / Active）；其他模块禁止私自 requestAnimationFrame
* 玩家输入先落 WAL 再结算；文件 IO 只在 main 进程
* Simulation Console 仅 DEV 构建；发布包 grep 不到 dev/ 代码
* 事件概率只允许发生在"条件满足"之后；微 / 成长 / 大三类事件有频率预算
