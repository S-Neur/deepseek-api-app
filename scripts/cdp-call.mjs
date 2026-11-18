/**
 * 按顺序执行一串 CDP 调用，用于模拟触摸、读取页面状态。
 *
 * 用法：node scripts/cdp-call.mjs <port> <stepsFile>
 * stepsFile 是 JSON 数组：[{ "method": "...", "params": {...}, "wait": 300 }, ...]
 * 每一步的返回值按顺序打印。
 */
import { readFileSync } from 'node:fs'

const [, , port = '9222', stepsFile] = process.argv
if (!stepsFile) {
  console.error('usage: node scripts/cdp-call.mjs <port> <stepsFile>')
  process.exit(1)
}
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'))

const response = await fetch(`http://127.0.0.1:${port}/json/list`)
const list = await response.json()
const page = list.find((t) => t.type === 'page')
if (!page) throw new Error('没有 page target')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let nextId = 1
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  const entry = pending.get(msg.id)
  if (!entry) return
  pending.delete(msg.id)
  entry(msg)
})

const call = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

for (const step of steps) {
  const msg = await call(step.method, step.params ?? {})
  const label = step.label ?? step.method
  if (msg.error) {
    console.log(`✗ ${label} →`, JSON.stringify(msg.error))
  } else {
    const value = msg.result?.result?.value ?? msg.result
    console.log(`✓ ${label} →`, typeof value === 'string' ? value : JSON.stringify(value))
  }
  if (step.wait) await new Promise((r) => setTimeout(r, step.wait))
}

ws.close()
