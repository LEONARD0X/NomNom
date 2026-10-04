import { Context, Next } from 'hono'
import { Bindings } from './types'

export async function authMiddleware(c: Context<{ Bindings: Bindings }>, next: Next) {
  // Allow health endpoint to be public for reachability & diagnostics check
  if (c.req.path === '/api/health') {
    return next()
  }

  const expectedToken = c.env.AUTH_TOKEN

  // If no AUTH_TOKEN is set in the environment, log error and notify caller
  if (!expectedToken || !expectedToken.trim()) {
    console.error(
      '[NomNom Auth Error] AUTH_TOKEN secret is NOT configured in the Worker environment!\n' +
      'Please open Cloudflare Dashboard -> Worker "nomnom" -> Settings -> Variables and Secrets -> Add "AUTH_TOKEN".'
    )
    return c.json({
      error: 'AUTH_TOKEN Secret fehlt auf dem Server. Bitte im Cloudflare Dashboard unter Settings -> Variables and Secrets als Secret hinterlegen.',
      code: 'AUTH_SECRET_MISSING'
    }, 500)
  }

  const authHeader = c.req.header('Authorization')
  if (!authHeader) {
    console.warn(`[NomNom Auth] Request to ${c.req.method} ${c.req.path} missing Authorization header.`)
    return c.json({
      error: 'Zugriff verweigert: Kein Authorization-Header übermittelt.',
      code: 'MISSING_AUTH_HEADER'
    }, 401)
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    console.warn(`[NomNom Auth] Invalid Authorization header format for ${c.req.path}: "${authHeader}"`)
    return c.json({
      error: 'Ungültiges Authorization-Format. Erwartet wird: Bearer <Zugangscode>',
      code: 'INVALID_AUTH_FORMAT'
    }, 401)
  }

  const providedToken = match[1].trim()
  if (providedToken !== expectedToken.trim()) {
    console.warn(
      `[NomNom Auth] Access denied: Token mismatch on ${c.req.method} ${c.req.path}. ` +
      `(Expected token length: ${expectedToken.trim().length}, provided token length: ${providedToken.length})`
    )
    return c.json({
      error: 'Ungültiger Zugangscode: Der eingegebene Token stimmt nicht mit dem AUTH_TOKEN Secret deines Cloudflare Workers überein.',
      code: 'INVALID_TOKEN'
    }, 401)
  }

  await next()
}
