/**
 * 把 classes.dex 和前端静态资源合进 aapt2 产出的 APK。
 *
 * 为什么不用 aapt2 -A：在 Windows 上 aapt2 会把资源条目写成 assets/www\index.html
 * （反斜杠），AssetManager 按正斜杠查找，装机后页面直接白屏。
 * 所以这里自己遍历目录、统一用正斜杠写入。
 *
 * 另外 Android 11+ 要求 targetSdk>=30 的 APK 里 resources.arsc 必须是 STORED，
 * 否则安装失败（INSTALL_PARSE_FAILED_RESOURCES_ARSC_COMPRESSED）。
 *
 * 用法：node scripts/pack-apk.mjs <base.apk> <classes.dex> <out.apk> [assetsDir] [assetsPrefix]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import path from 'node:path'

const [baseApk, dexPath, outApk, assetsDir, assetsPrefix = 'assets/www'] = process.argv.slice(2)
if (!baseApk || !dexPath || !outApk) {
  console.error('usage: node scripts/pack-apk.mjs <base.apk> <classes.dex> <out.apk>')
  process.exit(1)
}

/* ---------------- CRC32 ---------------- */
const TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

const crc32 = (buf) => {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/* ---------------- 读源 zip ---------------- */
const src = readFileSync(baseApk)

let eocd = -1
for (let i = src.length - 22; i >= 0; i--) {
  if (src.readUInt32LE(i) === 0x06054b50) {
    eocd = i
    break
  }
}
if (eocd < 0) throw new Error('EOCD not found')

const entryCount = src.readUInt16LE(eocd + 10)
let cdOffset = src.readUInt32LE(eocd + 16)
if (cdOffset === 0xffffffff) throw new Error('zip64 not supported')

const entries = []
for (let i = 0; i < entryCount; i++) {
  if (src.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('bad central dir')
  const flags = src.readUInt16LE(cdOffset + 8)
  const method = src.readUInt16LE(cdOffset + 10)
  const time = src.readUInt16LE(cdOffset + 12)
  const date = src.readUInt16LE(cdOffset + 14)
  const crc = src.readUInt32LE(cdOffset + 16)
  const csize = src.readUInt32LE(cdOffset + 20)
  const usize = src.readUInt32LE(cdOffset + 24)
  const nameLen = src.readUInt16LE(cdOffset + 28)
  const extraLen = src.readUInt16LE(cdOffset + 30)
  const commentLen = src.readUInt16LE(cdOffset + 32)
  const externalAttrs = src.readUInt32LE(cdOffset + 38)
  const localOffset = src.readUInt32LE(cdOffset + 42)
  const name = src.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen)

  if (flags & 0x08) throw new Error(`data descriptor not supported: ${name}`)

  const lNameLen = src.readUInt16LE(localOffset + 26)
  const lExtraLen = src.readUInt16LE(localOffset + 28)
  const dataStart = localOffset + 30 + lNameLen + lExtraLen
  const data = src.subarray(dataStart, dataStart + csize)

  entries.push({ name, method, time, date, crc, csize, usize, externalAttrs, data })
  cdOffset += 46 + nameLen + extraLen + commentLen
}

/* ---------------- 组装新条目 ---------------- */
// 必须 STORED 的条目：Android 11+ 的要求 + dex 让 zipalign 能对齐
const MUST_STORE = new Set(['resources.arsc', 'classes.dex'])

const normalize = (entry) => {
  if (!MUST_STORE.has(entry.name)) return entry
  const raw = entry.method === 0 ? entry.data : inflateRawSync(entry.data)
  return {
    ...entry,
    method: 0,
    data: raw,
    csize: raw.length,
    usize: raw.length,
    crc: crc32(raw),
  }
}

const finalEntries = []
for (const entry of entries) {
  if (entry.name === 'classes.dex') continue // 用新编的替换
  finalEntries.push(normalize(entry))
}

const dex = readFileSync(dexPath)
const dexDeflated = deflateRawSync(dex)
finalEntries.push(normalize({
  name: 'classes.dex',
  method: 8,
  time: 0,
  date: 0,
  crc: crc32(dex),
  csize: dexDeflated.length,
  usize: dex.length,
  externalAttrs: 0,
  data: dexDeflated,
}))

/* ---------------- 追加前端静态资源 ---------------- */
const walk = (dir) => {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

if (assetsDir) {
  const files = walk(assetsDir).sort()
  for (const file of files) {
    // 一律用正斜杠：包内路径必须是 POSIX 风格
    const rel = path.relative(assetsDir, file).split(path.sep).join('/')
    const body = readFileSync(file)
    const deflated = deflateRawSync(body, { level: 9 })
    // 压缩收益不大时直接存，减少解压开销
    const useStore = deflated.length >= body.length
    finalEntries.push({
      name: `${assetsPrefix}/${rel}`,
      method: useStore ? 0 : 8,
      time: 0,
      date: 0,
      crc: crc32(body),
      csize: useStore ? body.length : deflated.length,
      usize: body.length,
      externalAttrs: 0,
      data: useStore ? body : deflated,
    })
  }
  console.log(`added ${files.length} asset files under ${assetsPrefix}/`)
}

/* ---------------- 写 zip ---------------- */
const chunks = []
const central = []
let offset = 0

const DOS_TIME = 0
const DOS_DATE = (2026 - 1980) << 9 | (1 << 5) | 1 // 2026-01-01

for (const entry of finalEntries) {
  const nameBuf = Buffer.from(entry.name, 'utf8')
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4) // version needed
  local.writeUInt16LE(0x0800, 6) // utf-8 文件名
  local.writeUInt16LE(entry.method, 8)
  local.writeUInt16LE(entry.time || DOS_TIME, 10)
  local.writeUInt16LE(entry.date || DOS_DATE, 12)
  local.writeUInt32LE(entry.crc, 14)
  local.writeUInt32LE(entry.csize, 18)
  local.writeUInt32LE(entry.usize, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  local.writeUInt16LE(0, 28)

  chunks.push(local, nameBuf, entry.data)

  const cd = Buffer.alloc(46)
  cd.writeUInt32LE(0x02014b50, 0)
  cd.writeUInt16LE(20, 4) // version made by
  cd.writeUInt16LE(20, 6) // version needed
  cd.writeUInt16LE(0x0800, 8)
  cd.writeUInt16LE(entry.method, 10)
  cd.writeUInt16LE(entry.time || DOS_TIME, 12)
  cd.writeUInt16LE(entry.date || DOS_DATE, 14)
  cd.writeUInt32LE(entry.crc, 16)
  cd.writeUInt32LE(entry.csize, 20)
  cd.writeUInt32LE(entry.usize, 24)
  cd.writeUInt16LE(nameBuf.length, 28)
  cd.writeUInt16LE(0, 30)
  cd.writeUInt16LE(0, 32)
  cd.writeUInt16LE(0, 34)
  cd.writeUInt16LE(0, 36)
  cd.writeUInt32LE(entry.externalAttrs ?? 0, 38)
  cd.writeUInt32LE(offset, 42)

  central.push(cd, nameBuf)
  offset += 30 + nameBuf.length + entry.data.length
}

const cdBuf = Buffer.concat(central)
const eocdBuf = Buffer.alloc(22)
eocdBuf.writeUInt32LE(0x06054b50, 0)
eocdBuf.writeUInt16LE(0, 4)
eocdBuf.writeUInt16LE(0, 6)
eocdBuf.writeUInt16LE(finalEntries.length, 8)
eocdBuf.writeUInt16LE(finalEntries.length, 10)
eocdBuf.writeUInt32LE(cdBuf.length, 12)
eocdBuf.writeUInt32LE(offset, 16)
eocdBuf.writeUInt16LE(0, 20)

writeFileSync(outApk, Buffer.concat([...chunks, cdBuf, eocdBuf]))
console.log(`packed ${finalEntries.length} entries -> ${outApk}`)
for (const name of ['resources.arsc', 'classes.dex']) {
  const e = finalEntries.find((x) => x.name === name)
  if (e) console.log(`  ${name}: ${e.method === 0 ? 'STORED' : 'DEFLATE'} ${e.usize}B`)
}
