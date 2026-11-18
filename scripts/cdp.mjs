/**
 * 通过 Chrome DevTools 协议在 WebView 里执行一段 JS 并打印结果。
 *
 * 用法：node scripts/cdp.mjs <port> <exprFile>
 * 依赖：已经 adb forward 好端口（例如 adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>）
 *
 * 为什么需要它：自建 WebView 壳的问题（权限、安全上下文、手势收不到事件）
 * 在手机上只能靠猜，接上协议可以直接问页面它现在的真实状态。
 */
import { readFileSync } from 'node:fs'

const [, , port = '9222', exprFile] = process.argv
if (!exprFile) {
  console.error('usage: node scripts/cdp.mjs <port> <exprFile>')
  process.exit(1)
}
const expression = readFileSync(exprFile, 'utf8')

const base = `http://127.0.0.1:${port}`
let response
try {
  response = await fetch(`${base}/json/list`)
} catch (e) {
  throw new Error(`CDP 端口不可达（${base}）：${e.message}`)
}
const list = await response.json()

const page = list.find((t) => t.type === 'page')
if (!page) {
  console.error('没有可用的 page target，现有 target：')
  console.error(list.map((t) => `  ${t.type} ${t.url}`).join('\n'))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP 超时')), Number(process.env.CDP_TIMEOUT_MS ?? 60000))
  ws.addEventListener('open', () => {
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression,
          returnByValue: true,
          awaitPromise: true,
          userGesture: true,
        },
      })
    )
  })
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== 1) return
    clearTimeout(timer)
    resolve(msg)
  })
  ws.addEventListener('error', (e) => {
    clearTimeout(timer)
    reject(new Error(`WebSocket 错误：${e.message ?? e}`))
  })
})

ws.close()

// CDP 响应形如 { id, result: { result: RemoteObject, exceptionDetails? } }
const evaluateResult = result.result ?? {}
const { result: remoteObject, exceptionDetails } = evaluateResult
if (exceptionDetails) {
  console.error('页面抛异常：', JSON.stringify(exceptionDetails, null, 2))
  process.exit(1)
}
const value = remoteObject?.value
if (value === undefined && remoteObject?.description !== undefined) {
  console.error('（原始响应）', JSON.stringify(result, null, 2))
}
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
