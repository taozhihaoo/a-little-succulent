import { buildMain } from './lib/build-main.mjs'

await buildMain()
console.info('[build] main + preload → out/')
