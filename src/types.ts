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
  image_url?: string | null
}

export interface ProductDetails {
  product_id: number
  image_url: string | null
  nutriscore_grade: string | null
  nova_group: number | null
  ecoscore_grade: string | null
  ingredients: string | null
  nutriments_json: string | null
  created_at?: string
  updated_at?: string
}

export interface ProductDetailResponse {
  product: Product
  currentItem: Item | null
  details?: ProductDetails | null
}
