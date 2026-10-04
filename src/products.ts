import { Hono } from 'hono'
import { Bindings, Item, Product, ProductDetailResponse } from './types'

export const productRoutes = new Hono<{ Bindings: Bindings }>()

async function fetchFromOpenFoodFacts(barcode: string): Promise<string | null> {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,product_name_de,generic_name,generic_name_de,brands,quantity`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'NomNomAgent/1.0',
        'Accept': 'application/json'
      }
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return null
    }

    const data: any = await response.json()
    if (data.status !== 1 || !data.product) {
      return null
    }

    const p = data.product
    let name = (p.product_name_de || p.product_name || p.generic_name_de || p.generic_name || '').trim()
    const brand = (p.brands || '').trim()
    const quantity = (p.quantity || '').trim()

    if (!name && brand) {
      name = brand
    }

    if (!name) {
      return null
    }

    // Prepend brand if not already present in the name
    if (brand && !name.toLowerCase().includes(brand.toLowerCase())) {
      name = `${brand} ${name}`
    }

    // Append quantity if available
    if (quantity && !name.includes(quantity)) {
      name = `${name} · ${quantity}`
    }

    return name
  } catch (error) {
    console.error(`Error querying Open Food Facts for barcode ${barcode}:`, error)
    return null
  }
}

// GET /api/products/:barcode
productRoutes.get('/:barcode', async (c) => {
  const barcode = c.req.param('barcode').trim()
  if (!barcode) {
    return c.json({ error: 'Barcode parameter is required' }, 400)
  }

  const db = c.env.DB
  if (!db) {
    console.error('[NomNom D1 Error] Database binding c.env.DB is missing in Worker environment.')
    return c.json({ error: 'D1 Datenbank-Binding "DB" fehlt in der Worker-Konfiguration.', code: 'DB_BINDING_MISSING' }, 500)
  }

  // 1. Search in local D1 products
  let product = await db
    .prepare('SELECT id, barcode, name, created_at FROM products WHERE barcode = ?')
    .bind(barcode)
    .first<Product>()

  // 2. If not found, try Open Food Facts fallback
  if (!product) {
    const offName = await fetchFromOpenFoodFacts(barcode)
    if (offName) {
      const now = new Date().toISOString()
      const insertResult = await db
        .prepare('INSERT INTO products (barcode, name, created_at) VALUES (?, ?, ?) RETURNING id, barcode, name, created_at')
        .bind(barcode, offName, now)
        .first<Product>()

      if (insertResult) {
        product = insertResult
      }
    }
  }

  // 3. If still not found, return 404 so user can enter product manually
  if (!product) {
    return c.json({ error: 'Product not found', barcode }, 404)
  }

  // 4. Check if there is an active (open) item for this product
  const currentItem = await db
    .prepare('SELECT id, product_id, opened_at, finished_at, created_at FROM items WHERE product_id = ? AND finished_at IS NULL LIMIT 1')
    .bind(product.id)
    .first<Item>()

  const response: ProductDetailResponse = {
    product,
    currentItem: currentItem || null
  }

  return c.json(response)
})

// POST /api/products - Manual creation or update of product
productRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const barcode = String(body.barcode || '').trim()
  const name = String(body.name || '').trim()

  if (!barcode || !name) {
    return c.json({ error: 'Barcode and name are required' }, 400)
  }

  const db = c.env.DB
  const now = new Date().toISOString()

  // Insert or update product if barcode already exists
  const product = await db
    .prepare(`
      INSERT INTO products (barcode, name, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(barcode) DO UPDATE SET name = excluded.name
      RETURNING id, barcode, name, created_at
    `)
    .bind(barcode, name, now)
    .first<Product>()

  if (!product) {
    return c.json({ error: 'Failed to create product' }, 500)
  }

  const currentItem = await db
    .prepare('SELECT id, product_id, opened_at, finished_at, created_at FROM items WHERE product_id = ? AND finished_at IS NULL LIMIT 1')
    .bind(product.id)
    .first<Item>()

  return c.json({
    product,
    currentItem: currentItem || null
  }, 201)
})
