// Service Worker — Verum PWA (network-first for HTML/JS, cache-first for static assets)
const CACHE = 'verum-v3'
const PRECACHE_STATIC = ['/style.css', '/manifest.json', '/logo-transparent.png', '/favicon-64.png', '/icon-192.png']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE_STATIC))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

function isStaticAsset(url) {
  return /\.(css|png|jpg|jpeg|svg|webp|gif|woff2?|ico)$/i.test(url.pathname)
    || url.pathname === '/manifest.json'
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)

  // Never intercept dynamic / API / receipt content
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    url.pathname.startsWith('/uploads/')
  ) return

  // Static assets: cache-first
  if (isStaticAsset(url)) {
    e.respondWith(
      caches.match(e.request).then(cached => cached ?? fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()))
        return res
      }))
    )
    return
  }

  // HTML / JS / everything else: network-first (so login.html and app.js are always fresh)
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {})
        }
        return res
      })
      .catch(() => caches.match(e.request).then(cached => cached ?? caches.match('/')))
  )
})
