-- Migration 0001_initial.sql
-- Products table: defines unique products by barcode
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Items table: concrete tracking instances of opened products
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Ensure only one currently open item exists per product
CREATE UNIQUE INDEX IF NOT EXISTS one_open_item_per_product
ON items (product_id)
WHERE finished_at IS NULL;

-- Index for querying currently active/open items
CREATE INDEX IF NOT EXISTS idx_items_open
ON items (finished_at, opened_at DESC);
