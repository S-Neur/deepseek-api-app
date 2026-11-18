/**
 * 零依赖静态服务器，用来在局域网里预览 dist。
 * 用法：node scripts/serve.mjs [--port 8080] [--host 0.0.0.0]
 */
import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import path from 'node:path'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const port = Number(arg('port', '8080'))
const host = arg('host', '0.0.0.0')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

const notFound = (res) => {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('404')
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  let pathname = decodeURIComponent(url.pathname)
  if (pathname.endsWith('/')) pathname += 'index.html'

  const target = path.join(root, path.normalize(pathname).replace(/^([/\\])+/, ''))
  // 防止路径穿越
  if (!target.startsWith(root)) return notFound(res)

  let stat
  try {
    stat = statSync(target)
  } catch {
    // 单页应用：其他路径一律回退到 index.html
    const fallback = path.join(root, 'index.html')
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' })
    return createReadStream(fallback).pipe(res)
  }
  if (stat.isDirectory()) return notFound(res)

  const ext = path.extname(target).toLowerCase()
  const immutable = pathname.startsWith('/static/')
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    // 带 hash 的静态资源长缓存，其余不缓存，便于改完立即生效
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(target).pipe(res)
})

server.listen(port, host, () => {
  const addresses = [`http://localhost:${port}`]
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(`http://${net.address}:${port}`)
    }
  }
  console.log(`serving ${root}`)
  for (const address of addresses) console.log(`  ${address}`)
})
