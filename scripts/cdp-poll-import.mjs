/** 持续观察导入是否最终成功。用法：node scripts/cdp-poll-import.mjs <port> <seconds> */
const [, , port = '9222', seconds = '240'] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const deadline = Date.now() + Number(seconds) * 1000

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
  return msg.result?.result?.value
}

let lastSlices = -1
while (Date.now() < deadline) {
  const snapshot = await evaluate(`(()=>{
    const watch = window.__watch ?? [];
    const last = watch.at(-1) ?? {};
    const txt = document.body.innerText.replace(/\\n+/g,' | ');
    return JSON.stringify({ slices: last.slices ?? 0, mb: last.mb ?? null, txt: txt.slice(0,180) });
  })()`)
  const { slices, mb, txt } = JSON.parse(snapshot)
  const line = `slices=${slices} storage=${mb}MB`
  if (slices !== lastSlices) {
    console.log(`${new Date().toLocaleTimeString()} ${line}`)
    lastSlices = slices
  }
  if (/已导入|导入失败/.test(txt)) {
    console.log('终态:', txt)
    break
  }
  await sleep(5000)
}
console.log('结束观察')
ws.close()
