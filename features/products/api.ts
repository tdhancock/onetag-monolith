// Pure Supabase access for Products (ONE-40).
//
// No React, no hooks, nothing from another feature's internals. Images are
// uploaded through services/destinationMedia.ts, keyed by the account.
//
// Everyone reads products, their media and their specs, signed in or not: a
// product is a public discovery surface, and a scanned Tag resolves to one
// for someone without the app. Writes belong to the account owning the
// business profile, and RLS refuses anyone else.

import { supabase } from '../../services/supabase.native';
import { uploadDeviceImages } from '../../services/destinationMedia';
import {
  mapProductSummaryRow,
  PRODUCT_SUMMARY_SELECT,
  type ProductSummary,
  type ProductSummaryRow,
} from '../../services/productRows';
import type { AuthUserId } from '../../types';
import type {
  Product,
  ProductBusinessRow,
  ProductFields,
  ProductMedia,
  ProductMediaRow,
  ProductRow,
  ProductSearchResult,
  ProductSpec,
  ProductSpecRow,
  SpecInput,
} from './types';

/**
 * Every column a product page shows, with its media, specs and business
 * embedded — one request for the whole page. `products` has one foreign key
 * to `profiles`, named anyway so a second one could never make it ambiguous.
 */
export const PRODUCT_SELECT =
  'id, business_profile_id, name, description, category, price_cents, currency, available, created_at, ' +
  'product_media(id, url, media_type, sort_order), ' +
  'product_specs(id, label, value, sort_order), ' +
  'business:profiles!business_profile_id(id, username, full_name, avatar_url, is_verified)';

const one = <T>(embed: T | T[] | null | undefined): T | null =>
  Array.isArray(embed) ? embed[0] ?? null : embed ?? null;

const bySortOrder = <T extends { sort_order: number }>(a: T, b: T): number => a.sort_order - b.sort_order;

const mapMediaRow = (row: ProductMediaRow): ProductMedia => ({
  id: row.id,
  url: row.url,
  mediaType: row.media_type,
  sortOrder: row.sort_order,
});

const mapSpecRow = (row: ProductSpecRow): ProductSpec => ({
  id: row.id,
  label: row.label,
  value: row.value,
  sortOrder: row.sort_order,
});

const mapBusinessRow = (row: ProductBusinessRow): Product['business'] => ({
  id: row.id,
  username: row.username,
  name: row.full_name || row.username,
  avatarUrl: row.avatar_url,
  isVerified: row.is_verified === true,
});

/** A product row, its media and specs in sort order. */
export const mapProductRow = (row: ProductRow): Product => {
  const business = one(row.business);
  return {
    id: row.id,
    businessProfileId: row.business_profile_id,
    name: row.name,
    description: row.description,
    category: row.category,
    priceCents: row.price_cents,
    currency: row.currency,
    available: row.available,
    createdAt: row.created_at,
    media: [...(row.product_media ?? [])].sort(bySortOrder).map(mapMediaRow),
    specs: [...(row.product_specs ?? [])].sort(bySortOrder).map(mapSpecRow),
    business: business ? mapBusinessRow(business) : null,
  };
};

// ─── Reads ───────────────────────────────────────────────────────────────

/** One product with everything its page shows, or null when there is none. */
export const fetchProduct = async (productId: string): Promise<Product | null> => {
  const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).eq('id', productId).maybeSingle();
  if (error) throw error;
  return data ? mapProductRow(data as unknown as ProductRow) : null;
};

/** Every product a business lists, newest first. */
export const fetchBusinessProducts = async (businessProfileId: string): Promise<ProductSummary[]> => {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_SUMMARY_SELECT)
    .eq('business_profile_id', businessProfileId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as ProductSummaryRow[]).map(mapProductSummaryRow);
};

/** How many products a picker search returns. */
export const PRODUCT_SEARCH_LIMIT = 25;

/**
 * Products by name, from every business — for a project to Link (ONE-41),
 * which may Link any business's products, not only its owner's. An empty
 * search lists the newest. PostgREST reads `*` and `%` in a pattern as
 * wildcards, so they are taken out of what was typed.
 */
export const searchProducts = async (query: string): Promise<ProductSearchResult[]> => {
  let request = supabase
    .from('products')
    .select(`${PRODUCT_SUMMARY_SELECT}, business:profiles!business_profile_id(username, full_name)`);
  const term = query.replace(/[%*]/g, '').trim();
  if (term) request = request.ilike('name', `%${term}%`);

  const { data, error } = await request.order('created_at', { ascending: false }).limit(PRODUCT_SEARCH_LIMIT);
  if (error) throw error;

  return ((data ?? []) as unknown as (ProductSummaryRow & { business?: ProductBusinessRow | ProductBusinessRow[] | null })[]).map(
    (row) => {
      const business = one(row.business);
      return { ...mapProductSummaryRow(row), businessName: business ? business.full_name || business.username : null };
    },
  );
};

// ─── Writes ──────────────────────────────────────────────────────────────

const fieldsToRow = (fields: Partial<ProductFields>): Record<string, unknown> => {
  const row: Record<string, unknown> = {};
  if (fields.name !== undefined) row.name = fields.name;
  if (fields.description !== undefined) row.description = fields.description;
  if (fields.category !== undefined) row.category = fields.category;
  if (fields.priceCents !== undefined) row.price_cents = fields.priceCents;
  if (fields.currency !== undefined) row.currency = fields.currency;
  if (fields.available !== undefined) row.available = fields.available;
  return row;
};

/** What creating a product takes. */
export interface NewProductInput {
  /** The active profile: a business profile. The database refuses any other. */
  businessProfileId: string;
  fields: ProductFields;
  /** Device URIs or stored URLs, in the order they should show. */
  mediaUris: string[];
  specs: SpecInput[];
}

/**
 * Create a product with its images and specs, and return its id.
 *
 * Images go up first, keyed by the account, so a failed upload writes
 * nothing. The product, its media and its specs are three inserts; if the
 * second or third is refused, the product is deleted again — its cascade
 * takes anything already written — so a half-made product is never left
 * behind for the owner to find.
 */
export const createProduct = async (authUserId: AuthUserId, input: NewProductInput): Promise<string> => {
  const urls = await uploadDeviceImages(input.mediaUris, authUserId, 'products');

  const { data, error } = await supabase
    .from('products')
    .insert({ business_profile_id: input.businessProfileId, ...fieldsToRow(input.fields) })
    .select('id')
    .single();
  if (error) throw error;
  const productId = (data as { id: string }).id;

  try {
    if (urls.length > 0) {
      const { error: mediaError } = await supabase
        .from('product_media')
        .insert(urls.map((url, index) => ({ product_id: productId, url, sort_order: index })));
      if (mediaError) throw mediaError;
    }
    if (input.specs.length > 0) {
      const { error: specsError } = await supabase
        .from('product_specs')
        .insert(input.specs.map((spec, index) => ({ product_id: productId, ...spec, sort_order: index })));
      if (specsError) throw specsError;
    }
  } catch (writeError) {
    await supabase.from('products').delete().eq('id', productId);
    throw writeError;
  }

  return productId;
};

/**
 * Change a product's own fields. RLS filters a product the caller does not
 * own out of the update silently, so an empty result is an error here.
 */
export const updateProduct = async (productId: string, fields: Partial<ProductFields>): Promise<void> => {
  const row = fieldsToRow(fields);
  if (Object.keys(row).length === 0) return;
  const { data, error } = await supabase.from('products').update(row).eq('id', productId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Product not found.');
};

/** Where each image ends up: kept at a new position, added, or removed. */
export interface MediaChanges {
  inserts: { url: string; sortOrder: number }[];
  moves: { id: string; sortOrder: number }[];
  removals: string[];
}

/**
 * The writes that turn a product's stored media into `urls`, in that order.
 * Pure, so the reordering is tested without a network.
 *
 * A stored image is matched by its URL and keeps its row, rewriting only its
 * sort order; a URL with no row is added; a row whose URL is gone is removed.
 */
export const mediaChanges = (current: ProductMedia[], urls: string[]): MediaChanges => {
  const unmatched = [...current];
  const changes: MediaChanges = { inserts: [], moves: [], removals: [] };

  urls.forEach((url, sortOrder) => {
    const at = unmatched.findIndex((media) => media.url === url);
    if (at === -1) {
      changes.inserts.push({ url, sortOrder });
      return;
    }
    const [kept] = unmatched.splice(at, 1);
    if (kept!.sortOrder !== sortOrder) changes.moves.push({ id: kept!.id, sortOrder });
  });

  changes.removals = unmatched.map((media) => media.id);
  return changes;
};

/** A spec as edit saves it: `id` when it is already stored. */
export type SpecEdit = SpecInput & { id?: string };

export interface SpecChanges {
  inserts: (SpecInput & { sortOrder: number })[];
  updates: (SpecInput & { id: string; sortOrder: number })[];
  removals: string[];
}

/** The writes that turn a product's stored specs into `specs`, in that order. Pure. */
export const specChanges = (current: ProductSpec[], specs: SpecEdit[]): SpecChanges => {
  const stored = new Map(current.map((spec) => [spec.id, spec]));
  const changes: SpecChanges = { inserts: [], updates: [], removals: [] };
  const kept = new Set<string>();

  specs.forEach(({ id, label, value }, sortOrder) => {
    const before = id ? stored.get(id) : undefined;
    if (!before) {
      changes.inserts.push({ label, value, sortOrder });
      return;
    }
    kept.add(before.id);
    if (before.label !== label || before.value !== value || before.sortOrder !== sortOrder) {
      changes.updates.push({ id: before.id, label, value, sortOrder });
    }
  });

  changes.removals = current.filter((spec) => !kept.has(spec.id)).map((spec) => spec.id);
  return changes;
};

const throwIfError = async (request: PromiseLike<{ error: unknown }>): Promise<void> => {
  const { error } = await request;
  if (error) throw error;
};

/** Write a product's media in the order given. Additions first, removals last. */
export const saveProductMedia = async (productId: string, current: ProductMedia[], urls: string[]): Promise<void> => {
  const { inserts, moves, removals } = mediaChanges(current, urls);
  if (inserts.length > 0) {
    await throwIfError(
      supabase
        .from('product_media')
        .insert(inserts.map(({ url, sortOrder }) => ({ product_id: productId, url, sort_order: sortOrder }))),
    );
  }
  await Promise.all(
    moves.map(({ id, sortOrder }) =>
      throwIfError(supabase.from('product_media').update({ sort_order: sortOrder }).eq('id', id)),
    ),
  );
  if (removals.length > 0) await throwIfError(supabase.from('product_media').delete().in('id', removals));
};

/** Write a product's specs in the order given. Additions first, removals last. */
export const saveProductSpecs = async (productId: string, current: ProductSpec[], specs: SpecEdit[]): Promise<void> => {
  const { inserts, updates, removals } = specChanges(current, specs);
  if (inserts.length > 0) {
    await throwIfError(
      supabase.from('product_specs').insert(
        inserts.map(({ label, value, sortOrder }) => ({ product_id: productId, label, value, sort_order: sortOrder })),
      ),
    );
  }
  await Promise.all(
    updates.map(({ id, label, value, sortOrder }) =>
      throwIfError(supabase.from('product_specs').update({ label, value, sort_order: sortOrder }).eq('id', id)),
    ),
  );
  if (removals.length > 0) await throwIfError(supabase.from('product_specs').delete().in('id', removals));
};

/** An edit to a product: its fields, its images in order, and its specs in order. */
export interface ProductEdits {
  fields: ProductFields;
  mediaUris: string[];
  specs: SpecEdit[];
}

/**
 * Save an edit: new images uploaded first, keyed by the account, then the
 * fields, the media and the specs.
 */
export const saveProductEdits = async (authUserId: AuthUserId, product: Product, edits: ProductEdits): Promise<void> => {
  const urls = await uploadDeviceImages(edits.mediaUris, authUserId, 'products');
  await updateProduct(product.id, edits.fields);
  await saveProductMedia(product.id, product.media, urls);
  await saveProductSpecs(product.id, product.specs, edits.specs);
};

/**
 * Delete a product. Irreversible: its media, specs, project links and saves
 * cascade with it, and so does any Tag pointing at it — a printed one stops
 * resolving for everyone.
 */
export const deleteProduct = async (productId: string): Promise<void> => {
  const { data, error } = await supabase.from('products').delete().eq('id', productId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Product not found.');
};
