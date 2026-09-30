import { defineConfig } from 'vite'

export default defineConfig({
  clearScreen: false,
  // strictPort 关闭：端口被占用（如残留的 dev 进程）时 vite 自动顺延，URL 经
  // ELECTRON_RENDERER_URL 动态传给 main，无需固定
  server: { port: 5173, strictPort: false },
  build: { outDir: 'out/renderer', emptyOutDir: true },
})
