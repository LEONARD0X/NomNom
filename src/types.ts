export type Bindings = CloudflareBindings

export interface Product {
  id: number
  barcode: string
  name: string
  created_at: string
}

export interface Item {
  id: number
  product_id: number
  opened_at: string
  finished_at: string | null
  created_at: string
}

export interface OpenItemView {
  id: number
  product_id: number
  opened_at: string
  created_at: string
  barcode: string
  name: string
}

export interface ProductDetailResponse {
  product: Product
  currentItem: Item | null
}
