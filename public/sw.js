// NomNom Service Worker - App Shell Caching
const CACHE_NAME = 'nomnom-v5'
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-512.png',
  '/fonts/plus-jakarta-sans-v12-latin-regular.woff2',
  '/fonts/plus-jakarta-sans-v12-latin-600.woff2',
  '/fonts/plus-jakarta-sans-v12-latin-700.woff2'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE)
    }).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key)
          }
        })
      )
    }).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // API calls are never cached
  if (url.pathname.startsWith('/api/')) {
    return
  }

  // App shell / static assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache)
          })
        }
        return networkResponse
      }).catch(() => {
        // Network failed, return cached if exists
        return cachedResponse
      })

      return cachedResponse || fetchPromise
    })
  )
})
