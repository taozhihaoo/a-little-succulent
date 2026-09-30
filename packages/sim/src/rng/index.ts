/** 确定性 PRNG（02 §3.4）。所有随机只能经由命名流使用，禁止 Math.random（eslint 门禁）。 */

export type Rng = () => number

/** 字符串 seed → 32bit 混淆序列（xfnv1a） */
function seedHasher(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

/** sfc32：小而快的确定性 PRNG */
export function sfc32(a: number, b: number, c: number, d: number): Rng {
  let s0 = a >>> 0
  let s1 = b >>> 0
  let s2 = c >>> 0
  let s3 = d >>> 0
  return () => {
    s0 >>>= 0
    s1 >>>= 0
    s2 >>>= 0
    s3 >>>= 0
    let t = (s0 + s1) | 0
    s0 = s1 ^ (s1 >>> 9)
    s1 = (s2 + (s2 << 3)) | 0
    s2 = (s2 << 21) | (s2 >>> 11)
    s3 = (s3 + 1) | 0
    t = (t + s3) | 0
    s2 = (s2 + t) | 0
    return (t >>> 0) / 4294967296
  }
}

/** 由 seed 派生 Rng：同一 seed 永远得到同一序列（I1） */
export function createRng(seed: string): Rng {
  const next = seedHasher(seed)
  return sfc32(next(), next(), next(), next())
}
