/**
 * 把一张 512 source 图应用为应用图标（PWA + APK 全尺寸）。
 * 用法：node scripts/apply-icon.mjs assets/candidates/1-官方图标.png
 */
import sharp from 'sharp'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = process.argv[2]
if (!source) {
  console.error('usage: node scripts/apply-icon.mjs <512x512.png>')
  process.exit(1)
}

const srcPath = path.isAbsolute(source) ? source : path.resolve(root, source)
const assetsDir = path.join(root, 'assets')
const androidDrawable = path.join(root, 'android', 'res', 'drawable')
mkdirSync(assetsDir, { recursive: true })
mkdirSync(androidDrawable, { recursive: true })

/** 取图片四周的平均色，用作 maskable 图标的背景 */
const cornerColor = async () => {
  const { data, info } = await sharp(srcPath)
    .resize(8, 8, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const px = (x, y) => {
    const i = (y * info.width + x) * info.channels
    return [data[i], data[i + 1], data[i + 2]]
  }
  const samples = [px(0, 0), px(7, 0), px(0, 7), px(7, 7)]
  const avg = [0, 1, 2].map((c) => Math.round(samples.reduce((s, p) => s + p[c], 0) / samples.length))
  return { r: avg[0], g: avg[1], b: avg[2], alpha: 1 }
}

const bg = await cornerColor()

const resizeTo = async (size, out) => {
  const png = await sharp(srcPath).resize(size, size, { fit: 'cover' }).png().toBuffer()
  writeFileSync(out, png)
  console.log(`  ${path.relative(root, out)}  ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`)
}

const maskable = async (size, out) => {
  // 内容缩到 78%，四周留出安全区，避免被系统裁成圆形/方形时切掉
  const inner = Math.round(size * 0.78)
  const content = await sharp(srcPath).resize(inner, inner, { fit: 'contain', background: bg }).png().toBuffer()
  const png = await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: content, left: Math.round((size - inner) / 2), top: Math.round((size - inner) / 2) }])
    .png()
    .toBuffer()
  writeFileSync(out, png)
  console.log(`  ${path.relative(root, out)}  ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`)
}

console.log('应用图标:', path.relative(root, srcPath))
await resizeTo(512, path.join(assetsDir, 'icon-512.png'))
await resizeTo(192, path.join(assetsDir, 'icon-192.png'))
await resizeTo(180, path.join(assetsDir, 'apple-touch-icon.png'))
await resizeTo(64, path.join(assetsDir, 'favicon-64.png'))
await maskable(512, path.join(assetsDir, 'icon-maskable-512.png'))
await resizeTo(192, path.join(androidDrawable, 'ic_launcher.png'))

// 记录用的是哪张，方便回滚
writeFileSync(path.join(assetsDir, 'icon-source.txt'), path.relative(root, srcPath) + '\n')
console.log('done')
