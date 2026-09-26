// A Product as a list shows it — its name, price and representative image —
// for any feature that lists products (ONE-40, ONE-41).
//
// features/products lists a business's products; features/projects lists
// the products a project Links; a profile's saves list the products it saved.
// An api.ts may not import another feature (features/README.md, rule 1), so
// the select and its mapper sit here, as services/postRows.ts does for posts.

/** A product as a grid or list shows it. */
export interface ProductSummary {
  id: string;
  businessProfileId: string;
  name: string;
  category: string | null;
  /** In the currency's minor units. Null means no price is shown. */
  priceCents: number | null;
  currency: string;
  available: boolean;
  /** The first image by sort order, or null for a product with none. */
  imageUrl: string | null;
}

/** A `products` row with only its images' URLs and order embedded, to pick the first. */
export interface ProductSummaryRow {
  id: string;
  business_profile_id: string;
  name: string;
  category: string | null;
  price_cents: number | null;
  currency: string;
  available: boolean;
  product_media?: { url: string; sort_order: number }[] | null;
}

/** What a list reads of a product. Embeds as `product:products(…)` from a table that Links one. */
export const PRODUCT_SUMMARY_SELECT =
  'id, business_profile_id, name, category, price_cents, currency, available, product_media(url, sort_order)';

/** The first image by sort order: what represents a product everywhere but its own page. */
export const representativeImage = (media: { url: string; sort_order: number }[] | null | undefined): string | null =>
  [...(media ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]?.url ?? null;

export const mapProductSummaryRow = (row: ProductSummaryRow): ProductSummary => ({
  id: row.id,
  businessProfileId: row.business_profile_id,
  name: row.name,
  category: row.category,
  priceCents: row.price_cents,
  currency: row.currency,
  available: row.available,
  imageUrl: representativeImage(row.product_media),
});
