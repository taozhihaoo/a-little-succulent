/**
 * M6-3 种子码：把一株植株编码为可分享的 Base32 字符串，异地重建同一基因型。
 * 内容 = 版本 + 物种 + seed 串（utf8）+ 全基因座（量化 8bit，键序取默认表固定序）+ 异或校验。
 * 基因显式编码——不依赖双方机器的基因表随机一致性；版本字节防跨版本漂移。
 * 输出按 6 字符分组（'-' 分隔，解码时剥离），便于口头/截图分享。
 */
import { ECHEVERIA_DEFAULT_GENOME } from '../species/echeveria'
import type { Genome, SpeciesId } from '../world'

const VERSION = 1
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567' // RFC 4648 base32，无填充
const SPECIES_CODES: Record<string, number> = { echeveria: 1 }
/** 基因键固定序（JS 对象键插入序稳定；新基因只能追加在表尾，保证已发种子码兼容） */
const GENE_KEYS = Object.keys(ECHEVERIA_DEFAULT_GENOME)

export interface DecodedSeedCode {
  speciesId: SpeciesId
  seed: string
  genome: Genome
}

function bytesToBase32(bytes: number[]): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function base32ToBytes(str: string): number[] | null {
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const ch of str) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) return null
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return bytes
}

function utf8Encode(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i)!
    if (c > 0xffff) i++ // 代理对低位跳过
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

function utf8Decode(bytes: number[]): string {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]!
    if (b < 0x80) {
      out += String.fromCharCode(b)
      i += 1
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1]! & 63))
      i += 2
    } else if (b < 0xf0) {
      out += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1]! & 63) << 6) | (bytes[i + 2]! & 63))
      i += 3
    } else {
      out += String.fromCodePoint(((b & 7) << 18) | ((bytes[i + 1]! & 63) << 12) | ((bytes[i + 2]! & 63) << 6) | (bytes[i + 3]! & 63))
      i += 4
    }
  }
  return out
}

/** 编码种子码（抛错仅发生在非法输入：seed 过长等——调用方保证来源为真实植株） */
export function encodeSeedCode(plant: { speciesId: SpeciesId; seed: string; genome: Genome }): string {
  const speciesCode = SPECIES_CODES[plant.speciesId]
  if (speciesCode === undefined) throw new Error(`seedcode: unknown species ${plant.speciesId}`)
  const seedBytes = utf8Encode(plant.seed)
  if (seedBytes.length > 255) throw new Error('seedcode: seed too long')

  const body: number[] = [VERSION, speciesCode, seedBytes.length, ...seedBytes]
  for (const key of GENE_KEYS) {
    const v = plant.genome.values[key] ?? 0
    body.push(Math.max(0, Math.min(255, Math.round(v * 255))))
  }
  let xor = 0
  for (const b of body) xor ^= b
  const code = bytesToBase32([...body, xor])
  // 6 字符分组便于阅读；首组带版本可读前缀无必要——版本已在 payload 内
  return (code.match(/.{1,6}/g) ?? []).join('-')
}

/** 解码种子码：任何格式/校验失败返回 null（不抛错，输入来自用户粘贴） */
export function decodeSeedCode(code: string): DecodedSeedCode | null {
  const clean = code.trim().toUpperCase().replace(/[\s-]/g, '')
  const bytes = base32ToBytes(clean)
  if (!bytes || bytes.length < 5) return null
  const xor = bytes.pop()!
  let check = 0
  for (const b of bytes) check ^= b
  if (check !== xor) return null
  const [version, speciesCode, seedLen] = bytes
  if (version !== VERSION || seedLen === undefined) return null
  const speciesEntry = Object.entries(SPECIES_CODES).find(([, c]) => c === speciesCode)
  if (!speciesEntry) return null
  const seedBytes = bytes.slice(3, 3 + seedLen)
  if (seedBytes.length !== seedLen) return null
  const geneBytes = bytes.slice(3 + seedLen)
  if (geneBytes.length !== GENE_KEYS.length) return null
  const values: Record<string, number> = {}
  GENE_KEYS.forEach((key, i) => {
    values[key] = geneBytes[i]! / 255
  })
  return {
    speciesId: speciesEntry[0] as SpeciesId,
    seed: utf8Decode(seedBytes),
    genome: { values },
  }
}
