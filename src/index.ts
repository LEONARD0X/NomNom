import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { authMiddleware } from './auth'
import { itemRoutes } from './items'
import { productRoutes } from './products'
import { proxyRoutes } from './proxy'
import { Bindings } from './types'

const app = new Hono<{ Bindings: Bindings }>()

// Built-in request logger (outputs method, path, status, duration to Cloudflare Logs)
app.use('*', logger())

// Enable CORS for flexibility
app.use('*', cors())

// Prevent dynamic API endpoints from being cached by Workers Cache (proxy routes manage their own cache headers)
app.use('/api/*', async (c, next) => {
  await next()
  if (!c.req.path.startsWith('/api/proxy/')) {
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate')
  }
})

// Global error handler: catches all unhandled exceptions and logs detailed stack traces to Cloudflare Logs
app.onError((err, c) => {
  const method = c.req.method
  const url = c.req.url
  const path = c.req.path

  console.error(`[NomNom Worker Error] ${method} ${path}:`, {
    message: err.message,
    name: err.name,
    stack: err.stack,
    url
  })

  // Format friendly German error descriptions for common database/configuration issues
  let userFriendlyMessage = err.message || 'Interner Serverfehler'
  let errorCode = 'INTERNAL_SERVER_ERROR'

  if (err.message && err.message.includes('no such table')) {
    userFriendlyMessage = `Datenbank-Fehler: Tabelle existiert nicht (${err.message}). Hast du die D1-Migration auf der Remote-Datenbank ausgeführt?`
    errorCode = 'D1_TABLE_MISSING'
  } else if (!c.env.DB) {
    userFriendlyMessage = 'D1 Datenbank-Binding "DB" fehlt in der Worker-Konfiguration.'
    errorCode = 'D1_BINDING_MISSING'
  } else if (!c.env.AUTH_TOKEN) {
    userFriendlyMessage = 'AUTH_TOKEN Secret ist im Cloudflare Dashboard nicht hinterlegt.'
    errorCode = 'AUTH_SECRET_MISSING'
  }

  return c.json({
    error: userFriendlyMessage,
    code: errorCode,
    detail: err.message,
    path
  }, 500)
})

// Public health & diagnostics endpoint
app.get('/api/health', async (c) => {
  let dbStatus = 'ok'
  let dbError: string | null = null

  try {
    if (!c.env.DB) {
      dbStatus = 'missing_binding'
      dbError = 'D1 database binding "DB" is not configured'
    } else {
      // Diagnostic check: verify products table exists
      await c.env.DB.prepare('SELECT 1 FROM products LIMIT 1').first()
    }
  } catch (err: any) {
    dbStatus = 'table_error'
    dbError = err.message || 'Database query failed'
    console.error('[NomNom Health Check] Database check failed:', err.message)
  }

  const authConfigured = Boolean(c.env.AUTH_TOKEN && c.env.AUTH_TOKEN.trim().length > 0)
  if (!authConfigured) {
    console.warn('[NomNom Health Check] Warning: AUTH_TOKEN secret is not set in environment!')
  }

  const isHealthy = dbStatus === 'ok' && authConfigured

  return c.json({
    ok: isHealthy,
    name: 'NomNom API',
    time: new Date().toISOString(),
    auth: {
      configured: authConfigured
    },
    database: {
      status: dbStatus,
      error: dbError
    }
  }, isHealthy ? 200 : 503)
})

// Protect all /api/* routes with household Bearer token (authMiddleware exempts /api/health and /api/proxy/*)
app.use('/api/*', authMiddleware)

// Mount API routes
app.route('/api/proxy', proxyRoutes)
app.route('/api/products', productRoutes)
app.route('/api/items', itemRoutes)

// Fallback for static assets if routed through worker
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw)
  }
  return c.text('Not Found', 404)
})

export default app
