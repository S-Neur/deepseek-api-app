/**
 * 生成应用图标 PNG（无第三方依赖，直接手写 PNG 编码）。
 * 图形：蓝紫渐变圆角方块 + 白色对话气泡 + 三个圆点。
 * 用法：node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets')
mkdirSync(outDir, { recursive: true })

/* ---------------- PNG 编码 ---------------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

const crc32 = (buf) => {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

const encodePng = (width, height, rgba) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ---------------- 图形 ---------------- */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a, b, t) => a + (b - a) * t

/** 圆角矩形有向距离场（负值在内部） */
const sdRoundRect = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.min(Math.max(qx, qy), 0) + Math.sqrt(ax * ax + ay * ay) - r
}

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r

/** 三角形（顶点按逆时针）——用半平面求交近似 */
const inTriangle = (px, py, [ax, ay], [bx, by], [cx, cy]) => {
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3)
  const d1 = sign(px, py, ax, ay, bx, by)
  const d2 = sign(px, py, bx, by, cx, cy)
  const d3 = sign(px, py, cx, cy, ax, ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/**
 * 采样一点的颜色（已含透明度），坐标范围 0..1。
 * scale 控制图形占画布的比例（maskable 图标留出安全边距）。
 */
const sample = (u, v, scale) => {
  // 气泡范围
  const bw = 0.34 * scale
  const bh = 0.25 * scale
  const cx = 0.5
  const cy = 0.47
  const r = 0.11 * scale

  const inBubble = sdRoundRect(u, v, cx, cy, bw, bh, r) <= 0
  const inTail = inTriangle(u, v, [cx - bw * 0.68, cy + bh * 0.82], [cx - bw * 0.16, cy + bh * 0.8], [cx - bw * 0.56, cy + bh * 1.42])
  const dotR = 0.028 * scale
  const inDots =
    sdCircle(u, v, cx - 0.115 * scale, cy, dotR) <= 0 ||
    sdCircle(u, v, cx, cy, dotR) <= 0 ||
    sdCircle(u, v, cx + 0.115 * scale, cy, dotR) <= 0

  if (inBubble || inTail) {
    if (inDots) {
      // 气泡里的点用背景蓝
      return [0.30, 0.42, 0.98, 1]
    }
    return [1, 1, 1, 1]
  }
  return [0, 0, 0, 0]
}

/** 背景渐变（顶部亮、底部深），a 为纵向位置 0..1 */
const background = (a) => [
  mix(0.36, 0.20, a),
  mix(0.47, 0.29, a),
  mix(0.99, 0.95, a),
  1,
]

const render = (size, { scale = 1, rounded = true } = {}) => {
  const buf = Buffer.alloc(size * size * 4)
  const ss = 3 // 3x3 超采样抗锯齿
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size
          const v = (y + (sy + 0.5) / ss) / size
          // 圆角外轮廓
          const outside =
            rounded && sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.22) > 0
          if (outside) continue
          const bg = background(v)
          const fg = sample(u, v, scale)
          if (fg[3] === 0) {
            r += bg[0]
            g += bg[1]
            b += bg[2]
          } else {
            r += fg[0]
            g += fg[1]
            b += fg[2]
          }
          a += 1
        }
      }
      const n = ss * ss
      const i = (y * size + x) * 4
      // 覆盖率不足时按比例降低 alpha（圆角外侧）
      const cover = a / n
      buf[i] = Math.round(clamp01(r / n) * 255)
      buf[i + 1] = Math.round(clamp01(g / n) * 255)
      buf[i + 2] = Math.round(clamp01(b / n) * 255)
      buf[i + 3] = Math.round(cover * 255)
    }
  }
  return encodePng(size, size, buf)
}

const targets = [
  ['icon-192.png', 192, { scale: 1 }],
  ['icon-512.png', 512, { scale: 1 }],
  ['icon-maskable-512.png', 512, { scale: 0.78, rounded: false }],
  ['apple-touch-icon.png', 180, { scale: 0.9 }],
  ['favicon-64.png', 64, { scale: 1 }],
]

for (const [name, size, opts] of targets) {
  const png = render(size, opts)
  writeFileSync(path.join(outDir, name), png)
  console.log(`${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`)
}
