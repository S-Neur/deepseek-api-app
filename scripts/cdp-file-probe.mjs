/**
 * 在真机 WebView 里把导出包挂到一个独立 input 上，复刻 zipReader 的校验过程。
 * 目的：区分"解析失败"和"写库失败"，并定位到具体是哪一条校验没过。
 *
 * 用法：node scripts/cdp-file-probe.mjs <port> <zipPathOnDevice>
 */
const [, , port = '9222', zipPath] = process.argv
if (!zipPath) {
  console.error('usage: node scripts/cdp-file-probe.mjs <port> <zipPathOnDevice>')
  process.exit(1)
}

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

await call('DOM.enable')
await call('Runtime.enable')

// 1) 造一个独立 input，避免碰应用状态
const made = await call('Runtime.evaluate', {
  expression: `(()=>{
    const old = document.getElementById('__probe__'); if (old) old.remove();
    const input = document.createElement('input');
    input.type = 'file'; input.id = '__probe__'; input.style.display='none';
    document.body.appendChild(input);
    return 'created';
  })()`,
  returnByValue: true,
})
console.log('① 建输入框:', made.result?.result?.value ?? JSON.stringify(made.error))

const handleMsg = await call('Runtime.evaluate', {
  expression: `document.getElementById('__probe__')`,
  returnByValue: false,
})
const objectId = handleMsg.result?.result?.objectId
if (!objectId) {
  console.error('拿不到 input 句柄')
  process.exit(1)
}

const set = await call('DOM.setFileInputFiles', { files: [zipPath], objectId })
if (set.error) {
  console.error('② 注入失败:', JSON.stringify(set.error))
  process.exit(1)
}
console.log('② 注入文件: ok')

// 2) 复刻 zipReader.readDirectory 的校验
const probe = `(async () => {
  const report = { steps: [] };
  const push = (s, v) => report.steps.push(s + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)));
  try {
    const input = document.getElementById('__probe__');
    const file = input.files && input.files[0];
    if (!file) { push('file', 'missing'); return JSON.stringify(report, null, 2); }
    push('file.name', file.name);
    push('file.size', file.size);
    push('file.lastModified', file.lastModified);
    push('file.type', file.type || '(empty)');

    const t0 = performance.now();
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    push('head4', [...head].map(b => b.toString(16)).join(' '));
    push('read(0,4) 耗时ms', Math.round(performance.now() - t0));

    if (file.size < 22) { push('size', 'too small'); return JSON.stringify(report, null, 2); }

    const tailStart = Math.max(0, file.size - 22 - 0xffff);
    const t1 = performance.now();
    const tail = new Uint8Array(await file.slice(tailStart, file.size).arrayBuffer());
    push('tail 长度', tail.length + ' (期望 ' + (file.size - tailStart) + ')');
    push('tail 读取耗时ms', Math.round(performance.now() - t1));
    const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

    let end = tail.length - 22;
    while (end >= 0 && (tv.getUint32(end, true) !== 0x06054b50 || end + 22 + tv.getUint16(end + 20, true) !== tail.length)) end--;
    if (end < 0) { push('EOCD', 'not found'); return JSON.stringify(report, null, 2); }
    const count = tv.getUint16(end + 10, true);
    const cdSize = tv.getUint32(end + 12, true);
    const cdOffset = tv.getUint32(end + 16, true);
    push('count', count);
    push('cdSize', cdSize);
    push('cdOffset', cdOffset);
    push('disk(4,6)', tv.getUint16(end + 4, true) + ',' + tv.getUint16(end + 6, true));
    push('entriesThisDisk', tv.getUint16(end + 8, true));
    push('offset+size == tailStart+end', (cdOffset + cdSize) + ' vs ' + (tailStart + end));

    // 逐条走中央目录，报告第一条不通过的位置
    let cursor = 0;
    let firstBad = null;
    const t2 = performance.now();
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > cdSize) { firstBad = { index, why: 'cursor+46 > cdSize' }; break; }
      const slice = new Uint8Array(await file.slice(cdOffset + cursor, cdOffset + cursor + 46).arrayBuffer());
      if (slice.length !== 46) { firstBad = { index, why: 'short read', got: slice.length }; break; }
      const v = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
      if (v.getUint32(0, true) !== 0x02014b50) { firstBad = { index, why: 'bad signature', sig: v.getUint32(0, true).toString(16) }; break; }
      const flags = v.getUint16(8, true);
      const method = v.getUint16(10, true);
      const csize = v.getUint32(20, true);
      const usize = v.getUint32(24, true);
      const nameLen = v.getUint16(28, true);
      const extraLen = v.getUint16(30, true);
      const next = cursor + 46 + nameLen + extraLen + v.getUint16(32, true);
      const entryOffset = v.getUint32(42, true);
      const attrs = v.getUint32(38, true);
      const reason =
        (flags & ~0x80e) ? 'flags unsupported: ' + flags.toString(16) :
        (method !== 0 && method !== 8) ? 'method ' + method :
        csize === 0xffffffff ? 'zip64 csize' :
        usize === 0xffffffff ? 'zip64 usize' :
        (method === 0 && csize !== usize) ? 'stored mismatch' :
        entryOffset >= cdOffset ? 'entryOffset >= cdOffset' :
        v.getUint16(34, true) !== 0 ? 'disk start ' + v.getUint16(34, true) :
        ((attrs >>> 16) & 0xf000) === 0xa000 ? 'symlink attrs ' + attrs.toString(16) :
        next > cdSize ? 'next > cdSize' : null;
      if (reason) { firstBad = { index, why: reason, flags: flags.toString(16), method, csize, usize, attrs: attrs.toString(16) }; break; }
      cursor = next;
    }
    push('中央目录遍历耗时ms', Math.round(performance.now() - t2));
    push('cursor == cdSize', cursor + ' vs ' + cdSize);
    push('第一条不通过', firstBad ?? '无（全部通过）');

    // 抽 3 条试着解压，验证 deflate-raw 可用
    if (!firstBad) {
      const t3 = performance.now();
      let off = cdOffset, okCount = 0, failInfo = null;
      for (let i = 0; i < Math.min(count, 60) && i < count; i++) {
        const slice = new Uint8Array(await file.slice(off, off + 46).arrayBuffer());
        const v = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
        const method = v.getUint16(10, true);
        const csize = v.getUint32(20, true);
        const nameLen = v.getUint16(28, true);
        const extraLen = v.getUint16(30, true);
        const commentLen = v.getUint16(32, true);
        const entryOffset = v.getUint32(42, true);
        const name = new TextDecoder().decode(new Uint8Array(await file.slice(off + 46, off + 46 + nameLen).arrayBuffer()));
        const lh = new Uint8Array(await file.slice(entryOffset, entryOffset + 30).arrayBuffer());
        const lv = new DataView(lh.buffer, lh.byteOffset, lh.byteLength);
        const dataStart = entryOffset + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
        const raw = new Uint8Array(await file.slice(dataStart, dataStart + csize).arrayBuffer());
        try {
          if (method === 8) {
            const ds = new DecompressionStream('deflate-raw');
            const stream = new Blob([raw]).stream().pipeThrough(ds);
            const out = await new Response(stream).arrayBuffer();
            okCount++;
            if (i < 3) push('解压样例 ' + name, 'ok ' + out.byteLength + 'B');
          } else { okCount++; }
        } catch (e) { failInfo = name + ' -> ' + e.message; break; }
        off += 46 + nameLen + extraLen + commentLen;
      }
      push('前60条解压成功数', okCount);
      push('解压失败', failInfo ?? '无');
      push('解压耗时ms', Math.round(performance.now() - t3));
    }
  } catch (e) {
    push('EXCEPTION', e.name + ': ' + e.message);
  }
  return JSON.stringify(report, null, 2);
})()`

const result = await call('Runtime.evaluate', {
  expression: probe,
  returnByValue: true,
  awaitPromise: true,
  userGesture: true,
})
if (result.result?.exceptionDetails) {
  console.error('异常:', JSON.stringify(result.result.exceptionDetails, null, 2))
} else {
  const value = result.result?.result?.value
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
}

ws.close()
