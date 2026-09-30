import { readFileSync, writeFileSync } from 'node:fs'
const p = 'packages/sim/src/species/echeveria.ts'
let s = readFileSync(p, 'utf8')

// 1) offset 行：注释结尾补逗号
const before = s.length
s = s.replace(/(offset: radius \* sizeScale \* 0\.4 \/\/[^\n]*)/, (m) => m.replace(/[ \t]+$/, '') + ',')
if (s.length === before) throw new Error('offset line not patched')

// 2) growth/length 行：拆回两行（容错任意损坏形态）
const re = /[ \t]*growth: leaf\.maturity[^\n]*length,[^\n]*/
if (!re.test(s)) throw new Error('growth line not found')
s = s.replace(re, 'growth: leaf.maturity,\n        length,')

writeFileSync(p, s)
console.log('echeveria.ts patched')
