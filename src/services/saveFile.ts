/**
 * 把 Blob 存到用户能找到的位置。
 *
 * 为什么不能直接 <a download>：Android WebView 不会处理 download 属性 + blob URL，
 * 点了没有任何反应（下载回调压根不触发）。所以走原生桥接：分块 base64 传过去，
 * 原生先写临时文件，收尾时再发布到系统的「下载」目录。
 *
 * 浏览器环境（桌面预览）自动回退到普通的 <a download>。
 */

const CHUNK_BYTES = 512 * 1024

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(binary)
}

const browserDownload = (blob: Blob, name: string): string => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return name
}

export type SaveProgress = (written: number, total: number) => void

/** 返回给用户看的保存位置；失败抛错。 */
export const saveBlobToDevice = async (
  blob: Blob,
  name: string,
  onProgress?: SaveProgress
): Promise<string> => {
  const host = window.AppHost
  if (!host?.exportBegin || !host?.exportChunk || !host?.exportEnd) {
    onProgress?.(blob.size, blob.size)
    return browserDownload(blob, name)
  }

  const token = host.exportBegin(name)
  if (!token || token.startsWith('ERR')) {
    throw new Error(token ?? 'exportBegin failed')
  }

  try {
    let offset = 0
    while (offset < blob.size) {
      const end = Math.min(offset + CHUNK_BYTES, blob.size)
      const buffer = await blob.slice(offset, end).arrayBuffer()
      if (!host.exportChunk(token, toBase64(new Uint8Array(buffer)))) {
        throw new Error('写入文件失败')
      }
      offset = end
      onProgress?.(offset, blob.size)
      // 让出主线程：进度条能刷新，也不会让界面卡死
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const location = host.exportEnd(token)
    if (!location || location.startsWith('ERR')) {
      throw new Error(location ?? 'exportEnd failed')
    }
    return location
  } catch (error) {
    host.exportAbort?.(token)
    throw error
  }
}
