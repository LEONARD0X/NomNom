-- Migration 0002_product_details.sql
-- Product Details table: metadata from OpenFoodFacts (images, Nutri-Score, ingredients, nutriments)
CREATE TABLE IF NOT EXISTS product_details (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT,
  nutriscore_grade TEXT,
  nova_group INTEGER,
  ecoscore_grade TEXT,
  ingredients TEXT,
  nutriments_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
