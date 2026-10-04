import { Hono } from 'hono'
import { Bindings, Item, OpenItemView } from './types'

export const itemRoutes = new Hono<{ Bindings: Bindings }>()

// GET /api/items - Retrieve all currently open items
itemRoutes.get('/', async (c) => {
  const db = c.env.DB
  if (!db) {
    console.error('[NomNom D1 Error] Database binding c.env.DB is missing in Worker environment.')
    return c.json({ error: 'D1 Datenbank-Binding "DB" fehlt in der Worker-Konfiguration.', code: 'DB_BINDING_MISSING' }, 500)
  }

  let items: OpenItemView[] = []
  try {
    const { results } = await db
      .prepare(`
        SELECT
          items.id,
          items.product_id,
          items.opened_at,
          items.created_at,
          products.barcode,
          products.name,
          product_details.image_url
        FROM items
        JOIN products ON items.product_id = products.id
        LEFT JOIN product_details ON products.id = product_details.product_id
        WHERE items.finished_at IS NULL
        ORDER BY items.opened_at DESC
      `)
      .all<OpenItemView>()
    items = results || []
  } catch (err: any) {
    if (err.message && err.message.includes('product_details')) {
      const { results } = await db
        .prepare(`
          SELECT
            items.id,
            items.product_id,
            items.opened_at,
            items.created_at,
            products.barcode,
            products.name
          FROM items
          JOIN products ON items.product_id = products.id
          WHERE items.finished_at IS NULL
          ORDER BY items.opened_at DESC
        `)
        .all<OpenItemView>()
      items = results || []
    } else {
      throw err
    }
  }

  return c.json({ items })
})

// POST /api/items - Open a new item for a product
itemRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const productId = Number(body.product_id)

  if (!productId || isNaN(productId)) {
    return c.json({ error: 'Valid product_id is required' }, 400)
  }

  const db = c.env.DB

  // Verify product exists
  const product = await db
    .prepare('SELECT id, name FROM products WHERE id = ?')
    .bind(productId)
    .first()

  if (!product) {
    return c.json({ error: 'Product not found' }, 404)
  }

  // Check if an item is already open for this product
  const existingOpenItem = await db
    .prepare('SELECT id, product_id, opened_at, finished_at, created_at FROM items WHERE product_id = ? AND finished_at IS NULL LIMIT 1')
    .bind(productId)
    .first<Item>()

  if (existingOpenItem) {
    return c.json({ item: existingOpenItem, alreadyOpen: true }, 200)
  }

  const now = new Date().toISOString()
  let openedAt = now
  if (body.opened_at) {
    const parsed = new Date(body.opened_at)
    if (!isNaN(parsed.getTime())) {
      openedAt = parsed.toISOString()
    }
  }

  const newItem = await db
    .prepare(`
      INSERT INTO items (product_id, opened_at, finished_at, created_at)
      VALUES (?, ?, NULL, ?)
      RETURNING id, product_id, opened_at, finished_at, created_at
    `)
    .bind(productId, openedAt, now)
    .first<Item>()

  return c.json({ item: newItem }, 201)
})

// POST /api/items/:id/finish - Mark an item as finished
itemRoutes.post('/:id/finish', async (c) => {
  const itemId = Number(c.req.param('id'))
  if (!itemId || isNaN(itemId)) {
    return c.json({ error: 'Valid item id is required' }, 400)
  }

  const db = c.env.DB
  if (!db) {
    return c.json({ error: 'D1 Datenbank-Binding "DB" fehlt in der Worker-Konfiguration.' }, 500)
  }

  const now = new Date().toISOString()

  const updatedItem = await db
    .prepare(`
      UPDATE items
      SET finished_at = ?
      WHERE id = ? AND finished_at IS NULL
      RETURNING id, product_id, opened_at, finished_at, created_at
    `)
    .bind(now, itemId)
    .first<Item>()

  if (!updatedItem) {
    return c.json({ error: 'Item not found or already finished' }, 404)
  }

  return c.json({ success: true, item: updatedItem })
})

// POST /api/items/:id/reregister - Complete current item and open a new one atomically
itemRoutes.post('/:id/reregister', async (c) => {
  const itemId = Number(c.req.param('id'))
  if (!itemId || isNaN(itemId)) {
    return c.json({ error: 'Valid item id is required' }, 400)
  }

  const db = c.env.DB
  if (!db) {
    return c.json({ error: 'D1 Datenbank-Binding "DB" fehlt in der Worker-Konfiguration.' }, 500)
  }

  const body = await c.req.json().catch(() => ({}))

  // Find current item
  const currentItem = await db
    .prepare('SELECT id, product_id, finished_at FROM items WHERE id = ?')
    .bind(itemId)
    .first<Item>()

  if (!currentItem) {
    return c.json({ error: 'Item not found' }, 404)
  }

  const now = new Date().toISOString()
  let openedAt = now
  if (body.opened_at) {
    const parsed = new Date(body.opened_at)
    if (!isNaN(parsed.getTime())) {
      openedAt = parsed.toISOString()
    }
  }

  // Atomically finish current item and create new open item
  const [finishResult, insertResult] = await db.batch([
    db.prepare('UPDATE items SET finished_at = ? WHERE id = ?').bind(now, itemId),
    db.prepare(`
      INSERT INTO items (product_id, opened_at, finished_at, created_at)
      VALUES (?, ?, NULL, ?)
      RETURNING id, product_id, opened_at, finished_at, created_at
    `).bind(currentItem.product_id, openedAt, now)
  ])

  const newItem = insertResult.results[0] as Item

  return c.json({
    success: true,
    item: newItem
  })
})

// PATCH /api/items/:id - Update an item (e.g. correct opened_at timestamp)
itemRoutes.patch('/:id', async (c) => {
  const itemId = Number(c.req.param('id'))
  if (!itemId || isNaN(itemId)) {
    return c.json({ error: 'Valid item id is required' }, 400)
  }

  const db = c.env.DB
  if (!db) {
    return c.json({ error: 'D1 Datenbank-Binding "DB" fehlt in der Worker-Konfiguration.' }, 500)
  }

  const body = await c.req.json().catch(() => ({}))
  if (!body.opened_at) {
    return c.json({ error: 'opened_at ist erforderlich.' }, 400)
  }

  const parsed = new Date(body.opened_at)
  if (isNaN(parsed.getTime())) {
    return c.json({ error: 'Ungültiges Datumsformat.' }, 400)
  }

  const updatedItem = await db
    .prepare(`
      UPDATE items
      SET opened_at = ?
      WHERE id = ?
      RETURNING id, product_id, opened_at, finished_at, created_at
    `)
    .bind(parsed.toISOString(), itemId)
    .first<Item>()

  if (!updatedItem) {
    return c.json({ error: 'Item not found' }, 404)
  }

  return c.json({ success: true, item: updatedItem })
})
