/**
 * 用真实素材合成图标候选：
 * - 官方鲸鱼矢量路径（从官方 APK 的 adaptive icon 里提取）
 * - 鲸鱼娘透明贴图（refs/deepseek-whale-girl-icon/improved-1.png）
 *
 * 用法：node scripts/make-icons-from-assets.mjs
 * 输出：assets/candidates/*.png（512×512）
 */
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'assets', 'candidates')
mkdirSync(outDir, { recursive: true })

const SIZE = 512
const RADIUS = 112

/** 官方鲸鱼路径（512 视口，来自 APK 的 ic_launcher_foreground） */
const WHALE_PATH =
  'M436.33,157.34C432.65,155.51 430.99,159.08 428.97,160.82C428.23,161.47 427.59,162.2 426.94,162.93C421.88,169.45 415.16,172.56 406.97,172.29C394.36,171.37 383.87,175.68 375.4,185.13C373.93,173.76 367.86,165.96 357.27,161.83C351.75,159.82 347.15,156.61 343.37,152.02C341.26,148.35 339.78,144.5 338.95,140.37C338.13,137.99 337.39,135.51 334.63,135.05C331.96,134.6 330.58,137.16 329.48,139.27C325.06,147.89 323.03,157.16 323.31,166.97C323.22,177.24 325.52,186.87 330.3,195.95C335,205.03 341.62,212.46 350.09,218.05C352.21,219.06 352.85,220.71 351.93,222.91C350.73,227.13 349.36,231.26 348.16,235.39C347.33,238.23 346.04,238.69 343.28,237.59C333.71,233.37 325.33,227.5 317.97,219.89C306.19,206.68 293.58,194.3 280.14,182.65C276.83,180.18 273.61,177.79 270.11,175.59C255.48,161.19 272.04,149.36 275.72,147.99C279.5,146.52 277.11,141.47 264.4,141.57C250.69,142.48 237.71,145.88 225.29,151.84C223.08,152.66 220.87,153.4 218.48,153.85C204.58,151.1 190.59,150.65 176.51,152.39C148.71,155.23 126.9,168.35 111.07,191.82C91.92,219.61 85.85,250.15 92.75,283.35C98.55,317.93 114.84,346.27 141.62,368.46C168.5,392.31 199.7,403.13 235.41,400.65C263.11,400.65 287.32,391.3 308.12,372.68C316.4,376.44 325.06,378.46 334.08,378.64C342.45,379.29 350.64,378.64 358.83,376.72C369.6,374.42 368.87,364.06 364.91,362.23C333.52,347.37 340.43,353.33 334.17,348.29C350.09,328.75 374.2,308.48 383.59,242.82C383.96,238.6 383.96,234.38 383.59,230.16C383.59,227.5 384.14,226.58 387,226.22C394.91,225.3 402.46,222.82 409.46,218.79C429.8,207.32 437.99,188.43 439.92,165.87C440.2,162.66 439.92,159.08 436.33,157.34ZM259.07,360.85C228.69,336.18 213.97,328.02 207.71,328.38C201.45,328.75 203.01,335.45 204.3,339.85C205.5,343.88 207.34,347.55 209.73,350.95C211.02,352.41 211.48,354.06 211.11,355.99C210.74,357.82 209.73,359.2 207.98,360.12C198.23,366.35 181.2,358.01 180.46,357.55C159.85,345.44 143.83,328.84 132.33,307.75C120.82,286.75 114.57,264.28 113.46,240.25C113.46,234.47 114.84,232.36 120.73,231.35C128.1,229.88 135.37,229.7 142.82,230.71C174.02,235.48 200.53,249.33 222.34,272.53C234.4,285.92 245.17,300.5 254.37,316C264.4,332.33 276.37,347 290.36,359.93C294.5,363.6 298.83,366.99 303.34,370.11C291.92,371.49 272.5,371.76 259.07,360.85ZM273.79,264C273.7,260.98 275.26,259.42 278.3,259.33C278.76,259.23 279.31,259.23 279.77,259.33C280.42,259.6 280.97,259.97 281.52,260.42C282.9,261.98 283.18,263.64 282.35,265.47C281.61,267.39 280.23,268.31 278.21,268.4C275.26,268.4 273.88,266.94 273.79,264ZM319.07,288.03C316.31,289.41 313.46,290.14 310.52,290.42C306.19,290.6 302.23,289.32 298.83,286.65C294.59,283.99 291.92,280.14 290.82,275.19C290.36,272.26 290.36,269.32 290.82,266.39C292.2,261.89 291,258.22 287.32,255.38C284.38,253.18 281.06,252.17 277.29,252.45C276,252.35 274.8,251.9 273.61,251.25C271.12,250.06 270.57,248.23 271.95,245.84C272.78,244.65 273.7,243.64 274.71,242.63C280.33,239.88 285.94,239.88 291.46,242.63C297.08,245.66 302.05,249.6 306.19,254.46C309.87,258.77 313.18,263.36 316.13,268.22C318.8,272.16 321.01,276.48 322.57,281.06C323.58,284.09 322.48,286.56 319.07,288.03Z'

const roundedMask = Buffer.from(
  `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg"><rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}"/></svg>`
)

/** 官方鲸鱼整图（矢量直接渲染） */
const whaleSvg = ({ bg, whale }) => `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="w" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5d78fe"/>
      <stop offset="1" stop-color="#3d5afe"/>
    </linearGradient>
    <clipPath id="r"><rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}"/></clipPath>
  </defs>
  <g clip-path="url(#r)">
    <rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>
    <g transform="translate(${SIZE * 0.06}, ${SIZE * 0.06}) scale(${SIZE / 512 * 0.88})">
      <path d="${WHALE_PATH}" fill="${whale}"/>
    </g>
  </g>
</svg>`

const gradientBg = Buffer.from(`<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eaf0ff"/>
      <stop offset="1" stop-color="#c9d8ff"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="url(#g)"/>
</svg>`)

const solidBg = (color) => Buffer.from(`<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${color}"/>
</svg>`)

const girlSource = path.resolve(root, '..', 'refs', 'deepseek-whale-girl-icon', 'improved-1.png')

const composeGirl = async (bgBuffer, padding, outName) => {
  const inner = SIZE - padding * 2
  const girl = await sharp(girlSource)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
  const composed = await sharp(bgBuffer)
    .composite([{ input: girl, left: padding, top: padding }])
    .png()
    .toBuffer()
  const masked = await sharp(composed)
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer()
  writeFileSync(path.join(outDir, outName), masked)
  console.log(outName, (masked.length / 1024).toFixed(1) + ' KB')
}

const writeSvg = async (svg, name) => {
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  writeFileSync(path.join(outDir, name), png)
  console.log(name, (png.length / 1024).toFixed(1) + ' KB')
}

// 1. 官方：白底蓝渐变鲸鱼
await writeSvg(whaleSvg({ bg: '#ffffff', whale: 'url(#w)' }), '1-官方图标.png')
// 2. 官方：蓝底白鲸
await writeSvg(whaleSvg({ bg: '#4d6bfe', whale: '#ffffff' }), '2-官方蓝底白鲸.png')
// 3. 鲸鱼娘：浅蓝渐变底
await composeGirl(gradientBg, 6, '3-鲸鱼娘浅蓝.png')
// 4. 鲸鱼娘：白底
await composeGirl(solidBg('#ffffff'), 6, '4-鲸鱼娘白底.png')
