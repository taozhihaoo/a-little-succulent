import tseslint from 'typescript-eslint'

// 依赖边界门禁（07 §1 / §6）：
//   sim    ↛ three / electron / node:* / vite / vitest（测试文件除外） ❌
//   render ↛ electron / node:*                                        ❌
//   DOM / Node API 由各包 tsconfig 的 lib/types 编译期拦截。
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/dist-electron/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    // sim 测试文件：允许 vitest，其余纪律不变
    files: ['packages/sim/src/**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'sim 禁止 Math.random（I1：用 rng/ 命名流）' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'sim 禁止读取当前时间（ARCHITECTURE 不变量 3）' },
        { name: 'performance', message: 'sim 零计时 API（07 §3）' },
      ],
    },
  },
  {
    // sim 源码：纯 TS，零运行时依赖（I2）；测试文件由上面的块覆盖并排除
    files: ['packages/sim/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: 'sim 禁止依赖 three（I2）' },
            { group: ['electron', 'electron/*'], message: 'sim 禁止依赖 electron（I2）' },
            { group: ['node:*', 'fs', 'path', 'os'], message: 'sim 禁止依赖 Node API（I2，文件 IO 在主进程）' },
            { group: ['vite', 'vitest'], message: 'sim 源码禁止依赖构建/测试框架' },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'sim 禁止 Math.random（I1：用 rng/ 命名流）' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'sim 禁止读取当前时间（ARCHITECTURE 不变量 3）' },
        { name: 'performance', message: 'sim 零计时 API（07 §3）' },
      ],
    },
  },
  {
    // render：不碰进程与 OS
    files: ['packages/render/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['electron', 'electron/*'], message: 'render 禁止依赖 electron（07 §1）' },
            { group: ['node:*', 'fs', 'path', 'os'], message: 'render 禁止依赖 Node API（07 §1）' },
          ],
        },
      ],
    },
  },
)
