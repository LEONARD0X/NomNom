import { Hono } from 'hono'
import { Bindings } from './types'

export const proxyRoutes = new Hono<{ Bindings: Bindings }>()

// Allowed OpenFoodFacts image hosts to prevent open proxy abuse & SSRF
const ALLOWED_HOST_PATTERN = /^([a-z0-9-]+\.)?openfoodfacts\.(org|net)$/i

// Helper to convert an external OpenFoodFacts URL into our cached worker proxy URL
export function toProxiedImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  // Already a relative or proxied URL
  if (url.startsWith('/api/proxy/image') || url.startsWith('/')) {
    return url
  }
  // Only proxy OpenFoodFacts URLs
  if (url.includes('openfoodfacts.')) {
    return `/api/proxy/image?url=${encodeURIComponent(url)}`
  }
  return url
}

// GET /api/proxy/image?url=...
proxyRoutes.get('/image', async (c) => {
  let targetUrlStr = c.req.query('url')?.trim()

  if (!targetUrlStr) {
    return c.text('Missing "url" query parameter', 400)
  }

  // Handle protocol-relative URLs (e.g. //images.openfoodfacts.org/...)
  if (targetUrlStr.startsWith('//')) {
    targetUrlStr = `https:${targetUrlStr}`
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(targetUrlStr)
  } catch {
    return c.text('Invalid URL provided', 400)
  }

  // Security checks: only https/http and strictly OpenFoodFacts domains
  if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
    return c.text('Invalid protocol: only HTTP(S) allowed', 400)
  }

  if (!ALLOWED_HOST_PATTERN.test(targetUrl.hostname)) {
    return c.text('Forbidden: Host not allowed. Only OpenFoodFacts image URLs are permitted.', 403)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const response = await fetch(targetUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'NomNom/1.0',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return new Response(`Upstream image request failed with status ${response.status}`, {
        status: response.status,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      })
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg'
    // Verify it is actually an image or binary
    if (!contentType.startsWith('image/') && !contentType.startsWith('application/octet-stream')) {
      return new Response('Upstream response is not an image', {
        status: 400,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      })
    }

    // High cache control for Cloudflare Workers Cache & browser (30 days = 2,592,000s)
    const cacheControl = 'public, max-age=2592000, s-maxage=2592000, immutable'

    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
        'CDN-Cache-Control': cacheControl,
        'Cloudflare-CDN-Cache-Control': cacheControl,
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (err: any) {
    console.error('[NomNom Image Proxy Error]:', err)
    return new Response(`Failed to fetch image: ${err.message}`, {
      status: 502,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    })
  }
})
