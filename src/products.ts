import { Hono } from 'hono'
import { Bindings, Item, Product, ProductDetails, ProductDetailResponse } from './types'
import { toProxiedImageUrl } from './proxy'

export const productRoutes = new Hono<{ Bindings: Bindings }>()

interface OpenFoodFactsDetails {
  name: string
  imageUrl: string | null
  nutriscoreGrade: string | null
  novaGroup: number | null
  ecoscoreGrade: string | null
  ingredients: string | null
  nutrimentsJson: string | null
}

async function fetchFromOpenFoodFacts(barcode: string): Promise<OpenFoodFactsDetails | null> {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,product_name_de,generic_name,generic_name_de,brands,quantity,image_front_small_url,image_small_url,image_front_url,nutriscore_grade,nova_group,ecoscore_grade,ingredients_text_de,ingredients_text,nutriments`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4500)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'NomNom/1.0',
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
      name = `Produkt ${barcode}`
    } else {
      // Prepend brand if not already present in the name
      if (brand && !name.toLowerCase().includes(brand.toLowerCase())) {
        name = `${brand} ${name}`
      }
      // Append quantity if available
      if (quantity && !name.includes(quantity)) {
        name = `${name} · ${quantity}`
      }
    }

    // Image URL: prefer small 200-400px front thumbnail
    const imageUrl = (p.image_front_small_url || p.image_small_url || p.image_front_url || null) as string | null

    // Nutri-Score: 'a' | 'b' | 'c' | 'd' | 'e'
    let nutriscoreGrade: string | null = null
    if (typeof p.nutriscore_grade === 'string') {
      const g = p.nutriscore_grade.toLowerCase().trim()
      if (['a', 'b', 'c', 'd', 'e'].includes(g)) {
        nutriscoreGrade = g
      }
    }

    // NOVA Group: 1 | 2 | 3 | 4
    let novaGroup: number | null = null
    if (typeof p.nova_group === 'number' && [1, 2, 3, 4].includes(p.nova_group)) {
      novaGroup = p.nova_group
    }

    // Eco-Score: 'a' | 'b' | 'c' | 'd' | 'e'
    let ecoscoreGrade: string | null = null
    if (typeof p.ecoscore_grade === 'string') {
      const eg = p.ecoscore_grade.toLowerCase().trim()
      if (['a', 'b', 'c', 'd', 'e'].includes(eg)) {
        ecoscoreGrade = eg
      }
    }

    // Ingredients
    const rawIngredients = (p.ingredients_text_de || p.ingredients_text || '').trim()
    const ingredients = rawIngredients.length > 0 ? rawIngredients : null

    // Nutriments: per 100g / 100ml
    let nutrimentsJson: string | null = null
    if (p.nutriments && typeof p.nutriments === 'object') {
      const nm = p.nutriments
      const energyKcal = nm['energy-kcal_100g'] ?? nm['energy-kcal'] ?? (nm['energy_100g'] ? Math.round(Number(nm['energy_100g']) / 4.184) : null)
      const fat = nm['fat_100g'] ?? null
      const saturatedFat = nm['saturated-fat_100g'] ?? null
      const carbohydrates = nm['carbohydrates_100g'] ?? null
      const sugars = nm['sugars_100g'] ?? null
      const fiber = nm['fiber_100g'] ?? null
      const proteins = nm['proteins_100g'] ?? null
      const salt = nm['salt_100g'] ?? null

      if (energyKcal != null || fat != null || carbohydrates != null || proteins != null || salt != null) {
        nutrimentsJson = JSON.stringify({
          energyKcal: energyKcal != null ? Number(energyKcal) : null,
          fat: fat != null ? Number(fat) : null,
          saturatedFat: saturatedFat != null ? Number(saturatedFat) : null,
          carbohydrates: carbohydrates != null ? Number(carbohydrates) : null,
          sugars: sugars != null ? Number(sugars) : null,
          fiber: fiber != null ? Number(fiber) : null,
          proteins: proteins != null ? Number(proteins) : null,
          salt: salt != null ? Number(salt) : null
        })
      }
    }

    return {
      name,
      imageUrl,
      nutriscoreGrade,
      novaGroup,
      ecoscoreGrade,
      ingredients,
      nutrimentsJson
    }
  } catch (error) {
    console.error(`Error querying Open Food Facts for barcode ${barcode}:`, error)
    return null
  }
}

async function upsertProductDetails(
  db: CloudflareBindings['DB'],
  productId: number,
  details: OpenFoodFactsDetails
): Promise<ProductDetails | null> {
  const now = new Date().toISOString()
  try {
    const res = await db
      .prepare(`
        INSERT INTO product_details (
          product_id,
          image_url,
          nutriscore_grade,
          nova_group,
          ecoscore_grade,
          ingredients,
          nutriments_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_id) DO UPDATE SET
          image_url = excluded.image_url,
          nutriscore_grade = excluded.nutriscore_grade,
          nova_group = excluded.nova_group,
          ecoscore_grade = excluded.ecoscore_grade,
          ingredients = excluded.ingredients,
          nutriments_json = excluded.nutriments_json,
          updated_at = excluded.updated_at
        RETURNING *
      `)
      .bind(
        productId,
        details.imageUrl,
        details.nutriscoreGrade,
        details.novaGroup,
        details.ecoscoreGrade,
        details.ingredients,
        details.nutrimentsJson,
        now,
        now
      )
      .first<ProductDetails>()

    return res || null
  } catch (err: any) {
    console.warn('[NomNom] Failed to upsert product_details (table might not exist yet):', err.message)
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

  let details: ProductDetails | null = null

  // 2. If not found, try Open Food Facts fallback
  if (!product) {
    const off = await fetchFromOpenFoodFacts(barcode)
    if (off) {
      const now = new Date().toISOString()
      const insertResult = await db
        .prepare('INSERT INTO products (barcode, name, created_at) VALUES (?, ?, ?) RETURNING id, barcode, name, created_at')
        .bind(barcode, off.name, now)
        .first<Product>()

      if (insertResult) {
        product = insertResult
        details = await upsertProductDetails(db, product.id, off)
      }
    }
  } else {
    // Product already in local DB: fetch details
    try {
      details = await db
        .prepare('SELECT * FROM product_details WHERE product_id = ?')
        .bind(product.id)
        .first<ProductDetails>()
    } catch (_) {
      details = null
    }

    // Automatically supplement existing products in D1 with OpenFoodFacts details upon lookup if missing
    if (!details) {
      const off = await fetchFromOpenFoodFacts(barcode)
      if (off) {
        details = await upsertProductDetails(db, product.id, off)
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
    currentItem: currentItem || null,
    details: details ? {
      ...details,
      image_url: toProxiedImageUrl(details.image_url)
    } : null
  }

  return c.json(response)
})

// POST /api/products/:barcode/refresh - Refresh product details from OpenFoodFacts on demand
productRoutes.post('/:barcode/refresh', async (c) => {
  const barcode = c.req.param('barcode').trim()
  if (!barcode) {
    return c.json({ error: 'Barcode parameter is required' }, 400)
  }

  const db = c.env.DB
  if (!db) {
    return c.json({ error: 'D1 Datenbank-Binding "DB" fehlt in der Worker-Konfiguration.' }, 500)
  }

  const product = await db
    .prepare('SELECT id, barcode, name, created_at FROM products WHERE barcode = ?')
    .bind(barcode)
    .first<Product>()

  if (!product) {
    return c.json({ error: 'Produkt nicht gefunden' }, 404)
  }

  const off = await fetchFromOpenFoodFacts(barcode)
  if (!off) {
    return c.json({ error: 'Keine Daten bei OpenFoodFacts gefunden', success: false }, 404)
  }

  const details = await upsertProductDetails(db, product.id, off)

  const currentItem = await db
    .prepare('SELECT id, product_id, opened_at, finished_at, created_at FROM items WHERE product_id = ? AND finished_at IS NULL LIMIT 1')
    .bind(product.id)
    .first<Item>()

  return c.json({
    success: true,
    product,
    currentItem: currentItem || null,
    details: details ? {
      ...details,
      image_url: toProxiedImageUrl(details.image_url)
    } : null
  })
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

  // Supplement details if not present yet
  let details: ProductDetails | null = null
  try {
    details = await db.prepare('SELECT * FROM product_details WHERE product_id = ?').bind(product.id).first<ProductDetails>()
  } catch (_) {}

  if (!details) {
    const off = await fetchFromOpenFoodFacts(barcode)
    if (off) {
      details = await upsertProductDetails(db, product.id, off)
    }
  }

  const currentItem = await db
    .prepare('SELECT id, product_id, opened_at, finished_at, created_at FROM items WHERE product_id = ? AND finished_at IS NULL LIMIT 1')
    .bind(product.id)
    .first<Item>()

  return c.json({
    product,
    currentItem: currentItem || null,
    details: details ? {
      ...details,
      image_url: toProxiedImageUrl(details.image_url)
    } : null
  }, 201)
})

