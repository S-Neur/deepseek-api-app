/**
 * 触发一次导出并跟踪进度。
 * 用法：node scripts/cdp-export-verify.mjs <port>
 */
const [, , port = '9222'] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let nextId = 1
const pending = new Map()
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
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
  if (msg.result?.exceptionDetails) return `!EXC ${msg.result.exceptionDetails.text}`
  return msg.result?.result?.value
}

await call('Runtime.enable')

// 打开 设置 → 数据管理
const opened = await evaluate(`(()=>{
  const text = document.body.innerText;
  if (/通用设置/.test(text)) return 'already-open';
  const btn = document.querySelector('[class*="header-"]')?.querySelector('button');
  if (!btn) return 'no-menu';
  btn.click();
  return 'menu-clicked';
})()`)
if (opened === 'menu-clicked') {
  await sleep(700)
  await evaluate(`(()=>{const d=document.querySelector('[class*="drawer-"]');const b=d&&[...d.querySelectorAll('button')].find(x=>/设置/.test(x.textContent));b&&b.click()})()`)
  await sleep(800)
}
await evaluate(`(()=>{const t=[...document.querySelectorAll('button,[role="tab"]')].find(x=>/数据管理/.test(x.textContent));t&&t.click()})()`)
await sleep(700)

const clicked = await evaluate(`(()=>{
  const b=[...document.querySelectorAll('button')].find(x=>x.textContent.replace(/\\s/g,'')==='下载');
  if(!b) return 'no-download-button';
  if(b.disabled) return 'button-disabled';
  b.click(); return 'clicked';
})()`)
console.log('点击下载:', clicked)
if (clicked !== 'clicked') {
  ws.close()
  process.exit(1)
}

let last = ''
const started = Date.now()
for (let i = 0; i < 200; i++) {
  await sleep(3000)
  const text = await evaluate(`document.body.innerText.replace(/\\n+/g,' | ')`)
  const match =
    typeof text === 'string' ? text.match(/正在打包[^|]*|正在写入文件[^|]*|已保存到[^|]*|导出失败[^|]*/) : null
  const line = match ? match[0].trim() : '(无状态)'
  if (line !== last) {
    console.log(`+${Math.round((Date.now() - started) / 1000)}s  ${line}`)
    last = line
  }
  if (/已保存到|导出失败/.test(line)) {
    console.log(`耗时 ${Math.round((Date.now() - started) / 1000)}s`)
    break
  }
}
ws.close()
