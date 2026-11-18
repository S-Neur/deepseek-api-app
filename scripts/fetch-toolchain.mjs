/**
 * 下载构建 APK 所需的工具链（JDK + Android build-tools + platform）。
 * 只用 Node 内置能力，不依赖任何子进程。
 * 用法：node scripts/fetch-toolchain.mjs
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, '.toolchain', '_downloads')
mkdirSync(cacheDir, { recursive: true })

const TARGETS = [
  {
    name: 'jdk21.zip',
    // OpenJDK 21（华为云镜像，国内可直连）
    url: 'https://repo.huaweicloud.com/openjdk/21.0.2/openjdk-21.0.2_windows-x64_bin.zip',
    minBytes: 150e6,
  },
  {
    name: 'build-tools_r35.zip',
    url: 'https://dl.google.com/android/repository/build-tools_r35_windows.zip',
    minBytes: 40e6,
  },
  {
    name: 'platform-35.zip',
    url: 'https://dl.google.com/android/repository/platform-35_r02.zip',
    minBytes: 40e6,
  },
]

const fmt = (n) => (n / 1048576).toFixed(1) + ' MB'

const download = async ({ name, url, minBytes }) => {
  const dest = path.join(cacheDir, name)
  if (existsSync(dest) && statSync(dest).size >= minBytes) {
    console.log(`skip ${name} (${fmt(statSync(dest).size)})`)
    return dest
  }
  const started = Date.now()
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`${name}: HTTP ${response.status}`)
  const total = Number(response.headers.get('content-length') ?? 0)
  let received = 0
  let lastLog = 0
  const progress = new TransformStream({
    transform(chunk, controller) {
      received += chunk.length
      const now = Date.now()
      if (now - lastLog > 1000) {
        lastLog = now
        const speed = received / ((now - started) / 1000) / 1048576
        const pct = total ? `${((received / total) * 100).toFixed(0)}%` : fmt(received)
        console.log(`  ${name} ${pct} ${fmt(received)} ${speed.toFixed(1)} MB/s`)
      }
      controller.enqueue(chunk)
    },
  })
  // 先写 .part，避免中断留下半个文件被当成完整包
  const part = dest + '.part'
  await pipeline(Readable.fromWeb(response.body.pipeThrough(progress)), createWriteStream(part))
  const size = statSync(part).size
  if (size < minBytes) throw new Error(`${name}: 文件过小 ${fmt(size)}，可能下载不完整`)
  renameSync(part, dest)
  console.log(`done ${name} ${fmt(size)} in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  return dest
}

for (const target of TARGETS) {
  await download(target)
}
console.log('\nall downloads complete →', cacheDir)
