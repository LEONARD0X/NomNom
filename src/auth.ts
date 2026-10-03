import { Context, Next } from 'hono'
import { Bindings } from './types'

export async function authMiddleware(c: Context<{ Bindings: Bindings }>, next: Next) {
  // Allow health endpoint to be public for reachability check
  if (c.req.path === '/api/health') {
    return next()
  }

  const expectedToken = c.env.AUTH_TOKEN

  // If no AUTH_TOKEN is set in the environment, reject all requests for safety
  if (!expectedToken) {
    return c.json({ error: 'Worker authentication is not configured on the server.' }, 500)
  }

  const authHeader = c.req.header('Authorization')
  if (!authHeader) {
    return c.json({ error: 'Authorization header missing' }, 401)
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return c.json({ error: 'Invalid Authorization header format. Expected Bearer <token>' }, 401)
  }

  const providedToken = match[1].trim()
  if (providedToken !== expectedToken.trim()) {
    return c.json({ error: 'Unauthorized: Invalid token' }, 401)
  }

  await next()
}
