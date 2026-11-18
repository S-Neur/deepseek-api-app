/**
 * 重置页面 → 装观测探针 → 打开 设置/数据管理 → 返回「上传」按钮的 CSS 坐标。
 * 后续用 adb 点这个坐标打开系统选择器。
 */
import { readFileSync } from 'node:fs'

const [, , port = '9222'] = process.argv
const instrument = readFileSync('tmp/instrument.js', 'utf8')
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
await call('Page.enable')

console.log('① 重新加载页面')
await call('Page.reload', { ignoreCache: false })
for (let i = 0; i < 40; i++) {
  await sleep(250)
  const ready = await evaluate(`!!document.querySelector('[class*="header-"]')`)
  if (ready === true) break
}
await sleep(800)
console.log('  页面就绪')

console.log('② 装探针')
console.log(' ', await evaluate(instrument))

console.log('③ 打开 设置 → 数据管理')
await evaluate(`document.querySelector('[class*="header-"]')?.querySelector('button')?.click()`)
await sleep(600)
await evaluate(`(()=>{
  const b=[...document.querySelectorAll('button')].find(x=>x.textContent.replace(/\\s/g,'')==='设置');
  b?.click();
})()`)
await sleep(800)
await evaluate(`(()=>{
  const t=[...document.querySelectorAll('button, [role="tab"], [class*="tab"]')].find(x=>/数据管理/.test(x.textContent));
  t?.click();
})()`)
await sleep(800)

const rect = await evaluate(`(()=>{
  const b=[...document.querySelectorAll('button')].find(x=>x.textContent.replace(/\\s/g,'')==='上传');
  if(!b) return null;
  const r=b.getBoundingClientRect();
  return {x:r.x+r.width/2, y:r.y+r.height/2, w:r.width, h:r.height, disabled:b.disabled};
})()`)
console.log('④ 上传按钮:', JSON.stringify(rect))
console.log('   dpr:', await evaluate('window.devicePixelRatio'))

ws.close()
