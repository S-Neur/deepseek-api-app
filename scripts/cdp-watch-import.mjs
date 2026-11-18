/**
 * 点「确认导入」并全程记录文件读取情况。
 * 用法：node scripts/cdp-watch-import.mjs <port>
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

console.log('① 当前页面状态')
console.log('  文本:', String(await evaluate(`document.body.innerText.replace(/\\n+/g,' | ').slice(0,200)`)))
console.log('  探针:', await evaluate('typeof window.__log'))

console.log('② 点击「确认导入」')
const clicked = await evaluate(`(()=>{
  const b=[...document.querySelectorAll('button')].find(x=>/确认导入/.test(x.textContent));
  if(!b) return 'no-button';
  b.click(); return 'clicked';
})()`)
console.log(' ', clicked)

console.log('③ 观察 60 秒（每 2 秒打印一次新增读取记录）')
let printed = 0
for (let i = 0; i < 30; i++) {
  await sleep(2000)
  const snapshot = await evaluate(`(()=>{
    const log = window.__log ?? [];
    const watch = window.__watch ?? [];
    return JSON.stringify({
      total: log.length,
      head: log.slice(0, 6),
      tail: log.slice(-6),
      slices: (watch.at(-1)?.slices) ?? 0,
      mb: (watch.at(-1)?.mb) ?? null,
      secondsObserved: watch.length * 5,
    });
  })()`)
  const data = JSON.parse(snapshot)
  const elapsed = (i + 1) * 2
  console.log(`  +${elapsed}s  log=${data.total} slices=${data.slices} storage=${data.mb}MB`)
  if (data.total > printed) {
    for (const entry of data.tail) {
      console.log(`      ${entry.tag} ${JSON.stringify(entry.detail)}`)
    }
    printed = data.total
  }
  const text = await evaluate(`document.body.innerText.replace(/\\n+/g,' | ').slice(0,160)`)
  if (typeof text === 'string' && /已导入|导入失败/.test(text)) {
    console.log('  终态:', text)
    break
  }
}

console.log('④ 最终日志')
console.log(await evaluate('JSON.stringify((window.__log ?? []).slice(0,15), null, 2)'))
ws.close()
