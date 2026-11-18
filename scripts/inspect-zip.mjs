/** 分析导出包的 ZIP 结构，对照 src/services/chat/history/zipReader.ts 的接受条件 */
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

const buf = readFileSync(process.argv[2])

let eocd = -1
for (let i = buf.length - 22; i >= 0; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) {
    eocd = i
    break
  }
}
if (eocd < 0) {
  console.log('找不到 EOCD，不是标准 zip')
  process.exit(1)
}

const diskNumber = buf.readUInt16LE(eocd + 4)
const cdDisk = buf.readUInt16LE(eocd + 6)
const entriesThisDisk = buf.readUInt16LE(eocd + 8)
const totalEntries = buf.readUInt16LE(eocd + 10)
const cdSize = buf.readUInt32LE(eocd + 12)
const cdOffset = buf.readUInt32LE(eocd + 16)

// ZIP64 EOCD locator 就在 EOCD 前面 20 字节
const locatorSig = eocd >= 20 ? buf.readUInt32LE(eocd - 20) : 0
const zip64 = locatorSig === 0x07064b50

console.log('EOCD 位置      ', eocd, '/ 文件长度', buf.length)
console.log('分卷标记       ', diskNumber, cdDisk)
console.log('条目数         ', totalEntries, '(本盘', entriesThisDisk, ')')
console.log('中央目录        offset', cdOffset, 'size', cdSize)
console.log('ZIP64          ', zip64 ? '是（会被拒绝）' : '否')

let off = cdOffset
let dataDescriptor = 0
let encrypted = 0
let zip64Extra = 0
let methods = new Map()
let uncompressedTotal = 0
let compressedTotal = 0
let truncatedName = 0
let firstNames = []

for (let i = 0; i < totalEntries; i++) {
  if (buf.readUInt32LE(off) !== 0x02014b50) {
    console.log('中央目录在第', i, '条损坏，offset', off)
    break
  }
  const flags = buf.readUInt16LE(off + 8)
  const method = buf.readUInt16LE(off + 10)
  const csize = buf.readUInt32LE(off + 20)
  const usize = buf.readUInt32LE(off + 24)
  const nameLen = buf.readUInt16LE(off + 28)
  const extraLen = buf.readUInt16LE(off + 30)
  const commentLen = buf.readUInt16LE(off + 32)
  const name = buf.toString('utf8', off + 46, off + 46 + nameLen)

  if (flags & 0x08) dataDescriptor++
  if (flags & 0x01) encrypted++
  if (flags & 0x800) truncatedName++
  if (csize === 0xffffffff || usize === 0xffffffff) zip64Extra++
  methods.set(method, (methods.get(method) ?? 0) + 1)
  compressedTotal += csize
  uncompressedTotal += usize
  if (firstNames.length < 8) firstNames.push(name)
  off += 46 + nameLen + extraLen + commentLen
}

console.log('---')
console.log('压缩方式分布    ', [...methods].map(([m, n]) => `${m === 0 ? 'STORE' : m === 8 ? 'DEFLATE' : '其他(' + m + ')'}:${n}`).join(' '))
console.log('带数据描述符    ', dataDescriptor, '（bit3，部分解析器不接受）')
console.log('加密条目        ', encrypted)
console.log('ZIP64 扩展字段  ', zip64Extra)
console.log('压缩后总计      ', (compressedTotal / 1048576).toFixed(1), 'MB')
console.log('解压后总计      ', (uncompressedTotal / 1048576).toFixed(1), 'MB')
console.log('前几个条目      ', firstNames)

// 尝试读 manifest.json
let mOff = cdOffset
for (let i = 0; i < totalEntries; i++) {
  const flags = buf.readUInt16LE(mOff + 8)
  const method = buf.readUInt16LE(mOff + 10)
  const csize = buf.readUInt32LE(mOff + 20)
  const nameLen = buf.readUInt16LE(mOff + 28)
  const extraLen = buf.readUInt16LE(mOff + 30)
  const commentLen = buf.readUInt16LE(mOff + 32)
  const localOffset = buf.readUInt32LE(mOff + 42)
  const name = buf.toString('utf8', mOff + 46, mOff + 46 + nameLen)
  if (name === 'manifest.json') {
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(start, start + csize)
    const data = method === 0 ? raw : inflateRawSync(raw)
    console.log('--- manifest.json ---')
    console.log(data.toString('utf8').slice(0, 600))
    if (flags & 0x08) console.log('（manifest 也带数据描述符）')
    break
  }
  mOff += 46 + nameLen + extraLen + commentLen
}
