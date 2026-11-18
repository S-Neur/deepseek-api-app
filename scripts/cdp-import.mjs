/**
 * 在真机 WebView 里完整跑一次"导入历史"，并记录每一步的状态与耗时。
 *
 * 用法：node scripts/cdp-import.mjs <port> <zipPathOnDevice>
 */
const [, , port = '9222', zipPath] = process.argv
if (!zipPath) {
  console.error('usage: node scripts/cdp-import.mjs <port> <zipPathOnDevice>')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let nextId = 1
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  const done = pending.get(msg.id)
  if (done) {
    pending.delete(msg.id)
    done(msg)
  }
})
const call = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expression) => {
  const msg = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  })
  if (msg.result?.exceptionDetails) {
    return `!EXCEPTION: ${msg.result.exceptionDetails.text}`
  }
  return msg.result?.result?.value
}
const evaluateHandle = async (expression) => {
  const msg = await call('Runtime.evaluate', { expression, returnByValue: false })
  return msg.result?.result?.objectId
}
const step = (label, value) =>
  console.log(`  ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)

await call('DOM.enable')
await call('Runtime.enable')

console.log('① 打开抽屉 → 设置')
await evaluate(`document.querySelector('[class*="header-"]')?.querySelector('button')?.click()`)
await sleep(500)
step('设置面板', await evaluate(`(()=>{
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.replace(/\\s/g,'') === '设置')
  if (!b) return 'no-settings-button'
  b.click()
  return 'opened'
})()`))
await sleep(700)

console.log('② 切到「数据管理」')
step('标签', await evaluate(`(()=>{
  const candidates = [...document.querySelectorAll('button, [role="tab"], [class*="tab"]')]
  const tab = candidates.find((x) => /数据管理/.test(x.textContent))
  if (!tab) return 'no-data-tab'
  tab.click()
  return 'clicked:' + tab.textContent.trim()
})()`))
await sleep(700)

console.log('③ 定位 zip 输入框并注入文件')
const objectId = await evaluateHandle(`document.querySelector('input[type="file"][accept*=".zip"]')`)
if (!objectId) {
  step('输入框', 'not-found')
  step('页面文本', await evaluate(`document.body.innerText.replace(/\\n+/g,' | ').slice(0,400)`))
  process.exit(1)
}
const setResult = await call('DOM.setFileInputFiles', { files: [zipPath], objectId })
if (setResult.error) {
  console.error('  setFileInputFiles 失败：', JSON.stringify(setResult.error))
  process.exit(1)
}
step('注入', 'ok')
await sleep(1200)

console.log('④ 确认框')
step('页面文本', await evaluate(`document.body.innerText.replace(/\\n+/g,' | ').slice(0,400)`))
const clicked = await evaluate(`(()=>{
  const b = [...document.querySelectorAll('button')].find((x) => /确认导入/.test(x.textContent))
  if (!b) return 'no-confirm-button'
  b.click()
  return 'confirmed'
})()`)
step('确认', clicked)

console.log('⑤ 轮询导入（只在文本变化时打印）')
let last = ''
const startedAt = Date.now()
for (let i = 0; i < 60; i++) {
  await sleep(3000)
  const text = await evaluate(`document.body.innerText.replace(/\\n+/g,' | ').slice(0, 260)`)
  const elapsed = Math.round((Date.now() - startedAt) / 1000)
  if (text !== last) {
    console.log(`  +${elapsed}s  ${typeof text === 'string' ? text : JSON.stringify(text)}`)
    last = text
  }
  if (typeof text === 'string' && /已导入|导入失败/.test(text)) {
    console.log('  —— 终态 ——')
    break
  }
}

ws.close()
