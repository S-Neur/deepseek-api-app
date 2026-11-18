/** 从官方 APK 里提取启动器图标。用法：node scripts/extract-apk-icon.mjs <apk> <out.png> */
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

const [, , apkPath, outPath] = process.argv
if (!apkPath || !outPath) {
  console.error('usage: node scripts/extract-apk-icon.mjs <apk> <out.png>')
  process.exit(1)
}
const buf = readFileSync(apkPath)

let eocd = -1
for (let i = buf.length - 22; i >= 0; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) {
    eocd = i
    break
  }
}
if (eocd < 0) throw new Error('EOCD not found')

const count = buf.readUInt16LE(eocd + 10)
let off = buf.readUInt32LE(eocd + 16)
const entries = []
for (let i = 0; i < count; i++) {
  const method = buf.readUInt16LE(off + 10)
  const csize = buf.readUInt32LE(off + 20)
  const usize = buf.readUInt32LE(off + 24)
  const nameLen = buf.readUInt16LE(off + 28)
  const extraLen = buf.readUInt16LE(off + 30)
  const commentLen = buf.readUInt16LE(off + 32)
  const localOffset = buf.readUInt32LE(off + 42)
  const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
  entries.push({ name, method, csize, usize, localOffset })
  off += 46 + nameLen + extraLen + commentLen
}

const read = (entry) => {
  const nameLen = buf.readUInt16LE(entry.localOffset + 26)
  const extraLen = buf.readUInt16LE(entry.localOffset + 28)
  const start = entry.localOffset + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + entry.csize)
  return entry.method === 0 ? raw : inflateRawSync(raw)
}

const candidates = entries
  .filter((e) => /ic_launcher|icon/i.test(e.name) && /\.(png|webp)$/i.test(e.name))
  .sort((a, b) => b.usize - a.usize)

console.log('候选图标（按大小）:')
for (const c of candidates.slice(0, 10)) {
  console.log(`  ${(c.usize / 1024).toFixed(1).padStart(7)} KB  ${c.name}`)
}
if (candidates.length === 0) {
  console.error('没找到图标')
  process.exit(1)
}

const best = candidates[0]
writeFileSync(outPath, read(best))
console.log(`\n提取: ${best.name} → ${outPath}`)

const sharp = (await import('sharp')).default
const meta = await sharp(outPath).metadata()
console.log('尺寸:', meta.width, 'x', meta.height, meta.format, meta.hasAlpha ? '(带透明)' : '')
