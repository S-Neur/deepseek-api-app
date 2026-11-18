/**
 * 生成几款图标候选（纯几何绘制，不依赖任何图片素材）。
 * 用法：node scripts/make-icon-candidates.mjs
 * 输出：assets/candidates/*.png
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'candidates')
mkdirSync(outDir, { recursive: true })

/* ---------- PNG ---------- */
const CRC = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
const encodePng = (w, h, rgba) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ---------- 几何工具 ---------- */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a, b, t) => a + (b - a) * t
const sdRoundRect = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.min(Math.max(qx, qy), 0) + Math.sqrt(ax * ax + ay * ay) - r
}
const sdEllipse = (px, py, cx, cy, rx, ry) => {
  const dx = (px - cx) / rx
  const dy = (py - cy) / ry
  return Math.sqrt(dx * dx + dy * dy) - 1
}
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r
const inTriangle = (px, py, a, b, c) => {
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3)
  const d1 = sign(px, py, a[0], a[1], b[0], b[1])
  const d2 = sign(px, py, b[0], b[1], c[0], c[1])
  const d3 = sign(px, py, c[0], c[1], a[0], a[1])
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

/* ---------- 鲸鱼（侧视，头朝左） ---------- */
const whale = (u, v, scale = 1, ox = 0, oy = 0) => {
  const s = (x) => x * scale
  const X = u - ox
  const Y = v - oy
  const body = sdEllipse(X, Y, s(0.46), s(0.52), s(0.27), s(0.165)) <= 0
  const back = sdEllipse(X, Y, s(0.6), s(0.5), s(0.18), s(0.15)) <= 0
  const tailBase = inTriangle(
    X, Y,
    [s(0.64), s(0.46)], [s(0.64), s(0.58)], [s(0.8), s(0.52)]
  )
  const flukeTop = inTriangle(
    X, Y,
    [s(0.74), s(0.52)], [s(0.95), s(0.31)], [s(0.86), s(0.52)]
  )
  const flukeBottom = inTriangle(
    X, Y,
    [s(0.74), s(0.52)], [s(0.95), s(0.73)], [s(0.86), s(0.52)]
  )
  const flipper = sdEllipse(X, Y, s(0.44), s(0.635), s(0.105), s(0.045)) <= 0
  const eye = sdCircle(X, Y, s(0.295), s(0.505), s(0.021)) <= 0
  return {
    isBody: body || back || tailBase || flukeTop || flukeBottom || flipper,
    isEye: eye,
  }
}

/** 水花：三个小圆 */
const spout = (u, v, scale, ox, oy) =>
  sdCircle(u, v, ox + 0.33 * scale, oy + 0.21 * scale, 0.028 * scale) <= 0 ||
  sdCircle(u, v, ox + 0.395 * scale, oy + 0.17 * scale, 0.022 * scale) <= 0 ||
  sdCircle(u, v, ox + 0.27 * scale, oy + 0.18 * scale, 0.019 * scale) <= 0

/* ---------- 四种方案 ---------- */
const VARIANTS = {
  'A-白鲸蓝底': {
    bg: (a) => [mix(0.36, 0.18, a), mix(0.5, 0.31, a), mix(1.0, 0.96, a), 1],
    draw: (u, v) => {
      const w = whale(u, v, 1, 0, 0.02)
      if (w.isEye) return [0.24, 0.36, 0.95, 1]
      if (w.isBody) return [1, 1, 1, 1]
      if (spout(u, v, 1, 0, 0.02)) return [0.9, 0.95, 1, 1]
      return null
    },
  },
  'B-深蓝留白鲸': {
    bg: (a) => [mix(0.09, 0.05, a), mix(0.13, 0.08, a), mix(0.29, 0.19, a), 1],
    draw: (u, v) => {
      const w = whale(u, v, 1, 0, 0.02)
      if (w.isEye) return [0.09, 0.13, 0.29, 1]
      if (w.isBody) return [0.55, 0.72, 1, 1]
      if (spout(u, v, 1, 0, 0.02)) return [0.42, 0.6, 0.95, 1]
      return null
    },
  },
  'C-鲸尾跃水': {
    bg: (a) => [mix(0.13, 0.04, a), mix(0.44, 0.16, a), mix(0.86, 0.45, a), 1],
    draw: (u, v) => {
      // 鲸尾：两片宽尾鳍 + 水波
      const tail = inTriangle(u, v, [0.5, 0.6], [0.26, 0.24], [0.52, 0.4]) ||
        inTriangle(u, v, [0.5, 0.6], [0.74, 0.24], [0.48, 0.4])
      const stem = inTriangle(u, v, [0.46, 0.38], [0.54, 0.38], [0.5, 0.62])
      const wave1 = Math.abs(v - (0.7 + 0.03 * Math.sin(u * 12))) < 0.014 && u > 0.12 && u < 0.88
      const wave2 = Math.abs(v - (0.78 + 0.028 * Math.sin(u * 12 + 1.2))) < 0.011 && u > 0.2 && u < 0.8
      if (tail || stem) return [1, 1, 1, 1]
      if (wave1) return [0.85, 0.93, 1, 1]
      if (wave2) return [0.6, 0.78, 1, 1]
      return null
    },
  },
  'D-气泡蓝底': {
    bg: (a) => [mix(0.36, 0.2, a), mix(0.47, 0.29, a), mix(0.99, 0.95, a), 1],
    draw: (u, v) => {
      const bubble = sdRoundRect(u, v, 0.5, 0.48, 0.31, 0.235, 0.1) <= 0
      const tail = inTriangle(u, v, [0.34, 0.68], [0.47, 0.68], [0.36, 0.83])
      const dot =
        sdCircle(u, v, 0.39, 0.48, 0.033) <= 0 ||
        sdCircle(u, v, 0.5, 0.48, 0.033) <= 0 ||
        sdCircle(u, v, 0.61, 0.48, 0.033) <= 0
      if (bubble || tail) {
        return dot ? [0.3, 0.42, 0.98, 1] : [1, 1, 1, 1]
      }
      return null
    },
  },
}

const render = (size, variant, scale = 1, rounded = true) => {
  const buf = Buffer.alloc(size * size * 4)
  const ss = 3
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size
          const v = (y + (sy + 0.5) / ss) / size
          if (rounded && sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.22) > 0) continue
          const bg = variant.bg(v)
          const fg = variant.draw(u, v)
          if (fg) { r += fg[0]; g += fg[1]; b += fg[2] } else { r += bg[0]; g += bg[1]; b += bg[2] }
          a += 1
        }
      }
      const n = ss * ss
      const i = (y * size + x) * 4
      buf[i] = Math.round(clamp01(r / n) * 255)
      buf[i + 1] = Math.round(clamp01(g / n) * 255)
      buf[i + 2] = Math.round(clamp01(b / n) * 255)
      buf[i + 3] = Math.round((a / n) * 255)
    }
  }
  return encodePng(size, size, buf)
}

for (const [name, variant] of Object.entries(VARIANTS)) {
  const png = render(512, variant)
  const file = path.join(outDir, `${name}.png`)
  writeFileSync(file, png)
  console.log(`${name}.png  ${(png.length / 1024).toFixed(1)} KB`)
}
