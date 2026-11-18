/* 应用外壳的离线缓存。只缓存本站静态资源，绝不缓存 api.deepseek.com 的对话内容。 */
const VERSION = 'v1'
const SHELL_CACHE = `ds-shell-${VERSION}`
const RUNTIME_CACHE = `ds-runtime-${VERSION}`

/** 首次安装时预取的最小外壳 */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // 任一资源失败不应让整个安装失败
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

/** 仅处理同源 GET；API 请求、上传、SSE 一律直连网络 */
const shouldHandle = (request) => {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return false
  return true
}

/** 导航请求：先走网络，断网时回退到缓存的 index.html */
const handleNavigation = async (event) => {
  try {
    const response = await fetch(event.request)
    const cache = await caches.open(SHELL_CACHE)
    cache.put('./index.html', response.clone()).catch(() => {})
    return response
  } catch {
    const cached = await caches.match('./index.html')
    if (cached) return cached
    return new Response('离线且没有缓存副本', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}

/** 静态资源：先用缓存（快），同时后台更新（新版本下次生效） */
const handleAsset = async (event) => {
  const cached = await caches.match(event.request)
  const network = fetch(event.request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(RUNTIME_CACHE)
        cache.put(event.request, response.clone()).catch(() => {})
      }
      return response
    })
    .catch(() => cached)
  return cached ?? network
}

self.addEventListener('fetch', (event) => {
  if (!shouldHandle(event.request)) return
  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigation(event))
    return
  }
  event.respondWith(handleAsset(event))
})

/** 允许页面主动跳过等待，配合版本提示 */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})
