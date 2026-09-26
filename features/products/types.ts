// Domain types for Products (ONE-40).
//
// A Product is a catalog item a Business Profile lists: browsable, saveable,
// Linked from Projects, and one of the four Tag Destinations. It is not a
// thing you can buy — a price, when there is one, is display text.
//
// A product as a list shows it lives in services/productRows.ts, since other
// features list products too; it is re-exported here with the rest.

import type { ProductSummary } from '../../services/productRows';

export type { ProductSummary, ProductSummaryRow } from '../../services/productRows';

/** A product a project's picker offers (ONE-41): with the business that lists it. */
export interface ProductSearchResult extends ProductSummary {
  businessName: string | null;
}

/** One of a product's images. The first by `sortOrder` represents it everywhere. */
export interface ProductMedia {
  id: string;
  url: string;
  mediaType: 'photo' | 'video';
  sortOrder: number;
}

/** A label and value, shown as a row: "Material — White oak". */
export interface ProductSpec {
  id: string;
  label: string;
  value: string;
  sortOrder: number;
}

/** The business that lists a product, as its page shows it. */
export interface ProductBusiness {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  isVerified: boolean;
}

/** A product, with everything its page shows. */
export interface Product {
  id: string;
  businessProfileId: string;
  name: string;
  description: string | null;
  category: string | null;
  /** In the currency's minor units. Null means no price is shown. */
  priceCents: number | null;
  /** ISO 4217, e.g. `USD`. */
  currency: string;
  /** False when its business has taken it down without deleting it. */
  available: boolean;
  createdAt: string;
  /** In `sortOrder`; the first is the representative image. */
  media: ProductMedia[];
  /** In `sortOrder`. */
  specs: ProductSpec[];
  /** Null only if the business's profile could not be read. */
  business: ProductBusiness | null;
}

/** A spec as the owner edits it: no id until it is stored. */
export interface SpecInput {
  label: string;
  value: string;
}

/** A product's own fields, as create and edit write them. */
export interface ProductFields {
  name: string;
  description: string | null;
  category: string | null;
  priceCents: number | null;
  currency: string;
  available: boolean;
}

// ─── Rows ────────────────────────────────────────────────────────────────

export interface ProductMediaRow {
  id: string;
  product_id?: string;
  url: string;
  media_type: 'photo' | 'video';
  sort_order: number;
}

export interface ProductSpecRow {
  id: string;
  product_id?: string;
  label: string;
  value: string;
  sort_order: number;
}

export interface ProductBusinessRow {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  is_verified: boolean | null;
}

/** A `products` row with its media, specs and business embedded. */
export interface ProductRow {
  id: string;
  business_profile_id: string;
  name: string;
  description: string | null;
  category: string | null;
  price_cents: number | null;
  currency: string;
  available: boolean;
  created_at: string;
  product_media?: ProductMediaRow[] | null;
  product_specs?: ProductSpecRow[] | null;
  /** A one-to-one embed arrives as an object; an older server or a mock may hand back an array. */
  business?: ProductBusinessRow | ProductBusinessRow[] | null;
}
