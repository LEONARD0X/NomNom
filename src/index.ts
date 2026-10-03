import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Bindings } from './types'
import { authMiddleware } from './auth'
import { productRoutes } from './products'
import { itemRoutes } from './items'

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for flexibility
app.use('*', cors())

// Public health check endpoint
app.get('/api/health', (c) => {
  return c.json({
    ok: true,
    name: 'NomNom API',
    time: new Date().toISOString()
  })
})

// Protect all /api/* routes with household Bearer token
app.use('/api/*', authMiddleware)

// Mount API routes
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
