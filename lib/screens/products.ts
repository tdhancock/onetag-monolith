// Pure logic for the product screens under app/product/ (ONE-40): routes,
// price display, the create and edit form, and what each screen says. Kept
// out of the screens so it is tested without mounting anything.
//
// A price is display text. Nothing here computes a total, a discount or a
// checkout — commerce is permanently out of scope.

import type { Product, ProductEdits, ProductFields, SpecEdit } from '../../features/products';

// ─── Routes ─────────────────────────────────────────────────────────────

export const productRoute = (productId: string): string => `/product/${encodeURIComponent(productId)}`;

export const productEditRoute = (productId: string): string => `/product/${encodeURIComponent(productId)}/edit`;

export const PRODUCT_CREATE_ROUTE = '/product/create';

// ─── Who may do what ────────────────────────────────────────────────────

/**
 * Only a business profile lists products; the database refuses any other.
 * An individual profile is never offered the action (ONE-40).
 */
export const canCreateProduct = (profile: { profileType?: 'individual' | 'business' } | null | undefined): boolean =>
  profile?.profileType === 'business';

/**
 * Whether the active profile manages this product: it must be the business
 * profile that lists it. Another profile on the same account could get past
 * RLS, but a product is edited as the business that shows it, as the ticket
 * asks.
 */
export const canManageProduct = (
  profileId: string | undefined,
  product: Pick<Product, 'businessProfileId'> | null | undefined,
): boolean => Boolean(profileId && product && product.businessProfileId === profileId);

// ─── Price ──────────────────────────────────────────────────────────────

/**
 * How many minor units a currency has: 2 for USD, 0 for JPY. `price_cents`
 * holds the price in these, so ¥1,500 is stored as 1500 and $15 as 1500.
 */
export const currencyDigits = (currency: string): number => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
};

/**
 * A price as the product shows it — `$1,299.00`, `¥1,500` — or null when it
 * has none, in which case nothing is shown at all.
 */
export const formatPrice = (
  priceCents: number | null | undefined,
  currency: string,
  locale?: string,
): string | null => {
  if (priceCents === null || priceCents === undefined) return null;
  const digits = currencyDigits(currency);
  const amount = priceCents / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
};

/** A stored price as the form shows it: `1299.99`, or empty for none. */
export const priceInputFrom = (priceCents: number | null, currency: string): string => {
  if (priceCents === null) return '';
  const digits = currencyDigits(currency);
  return digits === 0 ? String(priceCents) : (priceCents / 10 ** digits).toFixed(digits);
};

/** `price_cents` is a Postgres integer. */
const PRICE_CENTS_MAX = 2_147_483_647;

export const PRICE_FORMAT_ERROR = 'Enter a price like 1299.99, or leave it empty.';

/**
 * Read a typed price into minor units. Commas and spaces are ignored; empty
 * means no price. Exact — worked in digits, never through a float.
 */
export const parsePriceInput = (input: string, currency: string): { cents: number | null; error: string | null } => {
  const cleaned = input.replace(/[\s,]/g, '');
  if (cleaned === '') return { cents: null, error: null };

  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return { cents: null, error: PRICE_FORMAT_ERROR };

  const digits = currencyDigits(currency);
  const fraction = match[2] ?? '';
  if (fraction.length > digits) {
    return {
      cents: null,
      error: digits === 0 ? `${currency} prices have no decimals.` : `Use at most ${digits} decimal places.`,
    };
  }

  const cents = Number(match[1]) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
  if (!Number.isSafeInteger(cents) || cents > PRICE_CENTS_MAX) return { cents: null, error: 'That price is too large.' };
  return { cents, error: null };
};

export const DEFAULT_CURRENCY = 'USD';

/** A currency as stored: ISO 4217, three capital letters. */
export const normalizeCurrency = (input: string): string => input.trim().toUpperCase();

export const currencyError = (input: string): string | null =>
  /^[A-Z]{3}$/.test(normalizeCurrency(input)) ? null : 'Use a three-letter currency code, like USD.';

// ─── The create and edit form ───────────────────────────────────────────

export const PRODUCT_NAME_MAX_LENGTH = 80;
export const PRODUCT_CATEGORY_MAX_LENGTH = 40;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 2000;
export const PRODUCT_MEDIA_MAX = 10;
export const PRODUCT_SPECS_MAX = 30;

/** An image in the form: a stored URL, or a photo just picked from the device. */
export interface MediaDraft {
  /** Stable across reordering, for list keys. */
  key: string;
  uri: string;
}

/** A spec in the form. `id` when it is already stored. */
export interface SpecDraft {
  key: string;
  id?: string;
  label: string;
  value: string;
}

export interface ProductDraft {
  name: string;
  category: string;
  description: string;
  price: string;
  currency: string;
  /** In the order they show; the first is the representative image. */
  media: MediaDraft[];
  /** In the order they show. */
  specs: SpecDraft[];
}

export const EMPTY_PRODUCT_DRAFT: ProductDraft = {
  name: '',
  category: '',
  description: '',
  price: '',
  currency: DEFAULT_CURRENCY,
  media: [],
  specs: [],
};

let draftKeys = 0;
/** A key for a new draft row, unique for the life of the app. */
export const newDraftKey = (): string => `draft-${(draftKeys += 1)}`;

/** A stored product as the edit form starts. */
export const productDraftFrom = (product: Product): ProductDraft => ({
  name: product.name,
  category: product.category ?? '',
  description: product.description ?? '',
  price: priceInputFrom(product.priceCents, product.currency),
  currency: product.currency,
  media: product.media.map((media) => ({ key: media.id, uri: media.url })),
  specs: product.specs.map((spec) => ({ key: spec.id, id: spec.id, label: spec.label, value: spec.value })),
});

/** Move one item of a list to another position. Out-of-range moves change nothing. */
export const moveItem = <T>(list: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
};

export interface ProductDraftErrors {
  name: string | null;
  price: string | null;
  currency: string | null;
  specs: string | null;
}

/** What is wrong with a draft, field by field. Empty optional fields are fine. */
export const productDraftErrors = (draft: ProductDraft): ProductDraftErrors => {
  const currency = currencyError(draft.currency);
  return {
    name: draft.name.trim() === '' ? 'Give the product a name.' : null,
    currency,
    // A price is read in its currency's units, so it waits for a valid one.
    price: currency ? null : parsePriceInput(draft.price, normalizeCurrency(draft.currency)).error,
    specs: draft.specs.some((spec) => spec.label.trim() === '' || spec.value.trim() === '')
      ? 'Every spec needs a label and a value.'
      : null,
  };
};

export const productDraftValid = (draft: ProductDraft): boolean =>
  Object.values(productDraftErrors(draft)).every((error) => error === null);

const textOrNull = (value: string): string | null => value.trim() || null;

/** A valid draft's own fields, as stored. */
export const productFieldsFrom = (draft: ProductDraft, available = true): ProductFields => {
  const currency = normalizeCurrency(draft.currency);
  return {
    name: draft.name.trim(),
    category: textOrNull(draft.category),
    description: textOrNull(draft.description),
    priceCents: parsePriceInput(draft.price, currency).cents,
    currency,
    available,
  };
};

const specEditsFrom = (draft: ProductDraft): SpecEdit[] =>
  draft.specs.map(({ id, label, value }) => ({ ...(id ? { id } : {}), label: label.trim(), value: value.trim() }));

/** What creating a product from a draft writes. */
export const newProductInputFrom = (draft: ProductDraft, businessProfileId: string) => ({
  businessProfileId,
  fields: productFieldsFrom(draft),
  mediaUris: draft.media.map((media) => media.uri),
  specs: specEditsFrom(draft).map(({ label, value }) => ({ label, value })),
});

/** What saving an edit writes. Availability is changed elsewhere, so it is kept. */
export const productEditsFrom = (draft: ProductDraft, product: Pick<Product, 'available'>): ProductEdits => ({
  fields: productFieldsFrom(draft, product.available),
  mediaUris: draft.media.map((media) => media.uri),
  specs: specEditsFrom(draft),
});

/** Whether an edit would save anything different from what is stored. */
export const productDraftChanged = (draft: ProductDraft, product: Product): boolean =>
  JSON.stringify(productEditsFrom(draft, product)) !== JSON.stringify(productEditsFrom(productDraftFrom(product), product));

// ─── What the screens say ───────────────────────────────────────────────

/** `2 / 5`: which photo the gallery is on. */
export const galleryPositionLabel = (index: number, total: number): string => `${index + 1} / ${total}`;

/** The product's kind and category, as its page's micro-label reads. */
export const productKindLabel = (product: Pick<Product, 'category'>): string =>
  ['Product', product.category].filter(Boolean).join(' · ');

export const UNAVAILABLE_LABEL = 'No longer available';

export const PRODUCT_PROJECTS_EMPTY = {
  title: 'Not in any projects yet',
  body: 'When a project Links this product, it shows here.',
} as const;

export const PRODUCT_NOT_FOUND = {
  title: 'Product not found',
  body: 'It may have been removed by the business that listed it.',
} as const;

/**
 * What deleting a product means, said before anything is removed (ONE-40).
 * A Tag pointing at it may already be printed on something someone is
 * holding. Marking it unavailable is the reversible alternative.
 */
export const deleteProductConfirm = (product: Pick<Product, 'name'>) => ({
  title: `Delete ${product.name}?`,
  body:
    'Its photos, specs and project links are deleted with it, and it disappears from everyone\'s saves. ' +
    'Any tag pointing at it stops working for good, including one already printed. ' +
    'To take it down for now, mark it unavailable instead: that can be undone.',
  confirm: 'Delete permanently',
});

export const PRODUCT_SAVE_FAILED = "Couldn't save the product. Nothing you entered was lost; try again.";
export const PRODUCT_PHOTO_FAILED = "A photo couldn't be uploaded, so nothing was saved. Try again.";
