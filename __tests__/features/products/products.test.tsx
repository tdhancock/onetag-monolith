/**
 * @jest-environment jsdom
 */
//
// target: __tests__/features/products/products.test.tsx
//
// Products (ONE-40): the data layer, the screen logic, and the product page,
// create and edit screens mounted over the real products and saves features
// and a real query client. Only the Supabase client (an in-memory database),
// the router, the acting profile and the native pickers are faked. What the
// database lets each viewer read is RLS's to decide, and pgTAP tests it
// (supabase/tests/products.test.sql); here the database answers as it would.
//
//   1. Rows become products with media and specs in sort order; the first
//      image represents the product.
//   2. A price is display text, formatted in its currency, and nothing else.
//   3. Creating uploads images under the account's id, then writes the
//      product, its media and its specs — and takes it all back if a write
//      fails. Reordering writes sort orders only.
//   4. The page shows the photos in order, the business and the projects that
//      use it, each routing onward; renders fully for someone signed out; and
//      has no buy affordance, with or without a price.
//   5. Only the business that lists it manages it; deleting says that its
//      tags stop working before anything is removed.
//   6. The edit screen's reorder persists.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../../support/reactNativeDom');
  const box = (props: { children?: React.ReactNode; accessibilityLabel?: string }) =>
    React.createElement('div', { 'aria-label': props.accessibilityLabel }, props.children);
  return {
    ...shim,
    ScrollView: box,
    KeyboardAvoidingView: box,
    RefreshControl: () => null,
    Platform: { OS: 'ios' },
    useWindowDimensions: () => ({ width: 375, height: 812 }),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('react-native-svg', () => require('../../support/reactNativeSvgStub'));
// Images render as <img>, so their order and sources can be read.
jest.mock('expo-image', () => {
  const React = require('react');
  return {
    Image: (p: { source?: { uri?: string }; accessibilityLabel?: string }) =>
      React.createElement('img', { src: p.source?.uri, 'aria-label': p.accessibilityLabel }),
  };
});

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
const mockParams: { current: Record<string, string> } = { current: {} };
const mockHeader: { title?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams.current,
  // The header's right slot renders inline, so the owner's ⋯ is reachable.
  Stack: {
    Screen: (p: { options?: { title?: string; headerRight?: () => unknown } }) => {
      mockHeader.title = p.options?.title;
      return p.options?.headerRight ? p.options.headerRight() : null;
    },
  },
}));

const mockToast = jest.fn();
jest.mock('../../../store/AppContext.native', () => ({ useApp: () => ({ addToast: mockToast }) }));

const mockActing: {
  profileId: string | undefined;
  authUserId: string | undefined;
  status: string;
  profile: Record<string, unknown>;
} = { profileId: 'p-studio', authUserId: 'a-owner', status: 'ready', profile: {} };
jest.mock('../../../features/profiles', () => ({ useCurrentProfile: () => mockActing }));
const mockAuth = { status: 'signed-in' };
jest.mock('../../../features/auth', () => ({ useAuthStatus: () => mockAuth.status }));

jest.mock('../../../services/destinationSharing', () => ({ shareDestination: jest.fn(() => Promise.resolve()) }));
const mockPick = jest.fn();
jest.mock('../../../services/mediaPicker', () => ({ pickImageFromLibrary: (...a: unknown[]) => mockPick(...a) }));
jest.mock('../../../services/localFile', () => ({
  readLocalFile: () => Promise.resolve({ arrayBuffer: new ArrayBuffer(1), contentType: 'image/jpeg', ext: 'jpg' }),
}));
jest.mock('../../../services/supabase.native', () => require('../../support/mockSupabaseDb').supabaseModule());

import { Alert } from 'react-native';
import { db, resetDb } from '../../support/mockSupabaseDb';
import ProductScreen from '../../../app/product/[id]';
import CreateProductScreen from '../../../app/product/create';
import EditProductScreen from '../../../app/product/[id]/edit';
import {
  createProduct,
  mapProductRow,
  mapProductSummaryRow,
  mediaChanges,
  specChanges,
  type ProductRow,
} from '../../../features/products';
import {
  canCreateProduct,
  canManageProduct,
  deleteProductConfirm,
  formatPrice,
  moveItem,
  parsePriceInput,
  priceInputFrom,
  productDraftErrors,
  EMPTY_PRODUCT_DRAFT,
} from '../../../lib/screens/products';
import { asAuthUserId } from '../../../types';

// ─── The database ───────────────────────────────────────────────────────

// The account and the business profile it owns have different ids, as every
// profile made after signup does (ONE-21).
const ACCOUNT = 'a-owner';
const STUDIO = { id: 'p-studio', username: 'oak_studio', full_name: 'Oak Studio', avatar_url: null, is_verified: true };

const DOOR = {
  id: 'pd-door',
  business_profile_id: 'p-studio',
  name: 'Oak door',
  description: 'Solid white oak, hand finished.',
  category: 'Doors',
  price_cents: 129999,
  currency: 'USD',
  available: true,
  created_at: '2026-09-20T00:00:00Z',
};

const seed = () => {
  resetDb({
    profiles: [STUDIO],
    products: [DOOR],
    // Stored out of order: the page must sort them.
    product_media: [
      { id: 'm-side', product_id: 'pd-door', url: 'https://cdn.example/side.jpg', media_type: 'photo', sort_order: 2 },
      { id: 'm-front', product_id: 'pd-door', url: 'https://cdn.example/front.jpg', media_type: 'photo', sort_order: 0 },
      { id: 'm-detail', product_id: 'pd-door', url: 'https://cdn.example/detail.jpg', media_type: 'photo', sort_order: 1 },
    ],
    product_specs: [
      { id: 's-size', product_id: 'pd-door', label: 'Size', value: '36 x 80 in', sort_order: 1 },
      { id: 's-wood', product_id: 'pd-door', label: 'Material', value: 'White oak', sort_order: 0 },
    ],
    projects: [
      { id: 'pj-barn', owner_profile_id: 'p-builder', name: 'Barn conversion', project_type: 'Renovation', year: '2025', cover_url: null, is_public: true, created_at: '2026-01-01T00:00:00Z' },
      { id: 'pj-loft', owner_profile_id: 'p-builder', name: 'City loft', project_type: 'Interior', year: '2026', cover_url: 'https://cdn.example/loft.jpg', is_public: true, created_at: '2026-06-01T00:00:00Z' },
    ],
    project_products: [
      { id: 'pp-1', project_id: 'pj-barn', product_id: 'pd-door' },
      { id: 'pp-2', project_id: 'pj-loft', product_id: 'pd-door' },
    ],
    saves: [],
  });
  db.embeds = {
    products: (row) => ({
      ...row,
      product_media: db.tables.product_media!.filter((m) => m.product_id === row.id),
      product_specs: db.tables.product_specs!.filter((s) => s.product_id === row.id),
      business: db.tables.profiles!.find((p) => p.id === row.business_profile_id) ?? null,
    }),
    project_products: (row) => ({ project: db.tables.projects!.find((p) => p.id === row.project_id) ?? null }),
  };
};

// ─── Mounting ───────────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(screen: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={client}>{screen}</QueryClientProvider>));
  await settle();
  return container;
}

const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll('button'));
const byText = (el: HTMLElement, text: string) => buttons(el).find((b) => b.textContent === text);
const byLabel = (el: HTMLElement, label: string) => el.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
const click = async (target: HTMLElement | null | undefined) => {
  act(() => (target as HTMLElement).click());
  await settle();
};
const type = async (el: HTMLElement, label: string, value: string) => {
  const input = byLabel(el, label) as HTMLInputElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle(2);
};

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  seed();
  mockActing.profileId = 'p-studio';
  mockActing.authUserId = ACCOUNT;
  mockActing.status = 'ready';
  mockActing.profile = { id: 'p-studio', username: 'oak_studio', profileType: 'business' };
  mockAuth.status = 'signed-in';
  mockParams.current = { id: 'pd-door' };
  [mockRouter.push, mockRouter.back, mockRouter.replace, mockToast, mockPick].forEach((m) => m.mockReset());
  mockRouter.canGoBack.mockReturnValue(true);
  (Alert.alert as jest.Mock).mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  client.clear();
});

// ─── 1. Rows ────────────────────────────────────────────────────────────

describe('a product row', () => {
  const row = (): ProductRow => ({
    ...DOOR,
    product_media: [
      { id: 'b', url: 'b.jpg', media_type: 'photo', sort_order: 1 },
      { id: 'a', url: 'a.jpg', media_type: 'photo', sort_order: 0 },
    ],
    product_specs: [
      { id: 'y', label: 'Finish', value: 'Oiled', sort_order: 1 },
      { id: 'x', label: 'Wood', value: 'Oak', sort_order: 0 },
    ],
    business: [STUDIO],
  });

  it('has its media and specs in sort order, and its business', () => {
    const product = mapProductRow(row());
    expect(product.media.map((m) => m.url)).toEqual(['a.jpg', 'b.jpg']);
    expect(product.specs.map((s) => s.label)).toEqual(['Wood', 'Finish']);
    expect(product.business).toEqual({ id: 'p-studio', username: 'oak_studio', name: 'Oak Studio', avatarUrl: null, isVerified: true });
  });

  it('is represented by its first image by sort order, wherever it is listed', () => {
    const summary = mapProductSummaryRow({ ...DOOR, product_media: [{ url: 'late.jpg', sort_order: 3 }, { url: 'first.jpg', sort_order: 0 }] });
    expect(summary.imageUrl).toBe('first.jpg');
    expect(mapProductSummaryRow({ ...DOOR, product_media: [] }).imageUrl).toBeNull();
  });
});

// ─── 2. Price ───────────────────────────────────────────────────────────

describe('a price', () => {
  it('is formatted in its currency, from minor units', () => {
    expect(formatPrice(129999, 'USD', 'en-US')).toBe('$1,299.99');
    expect(formatPrice(1500, 'JPY', 'en-US')).toBe('¥1,500');
    expect(formatPrice(0, 'EUR', 'en-US')).toBe('€0.00');
  });

  it('is nothing at all when there is none', () => {
    expect(formatPrice(null, 'USD')).toBeNull();
  });

  it('reads what the owner types, exactly', () => {
    expect(parsePriceInput('1,299.99', 'USD')).toEqual({ cents: 129999, error: null });
    expect(parsePriceInput('12', 'USD')).toEqual({ cents: 1200, error: null });
    expect(parsePriceInput('0.1', 'USD')).toEqual({ cents: 10, error: null });
    expect(parsePriceInput('1500', 'JPY')).toEqual({ cents: 1500, error: null });
    expect(parsePriceInput('', 'USD')).toEqual({ cents: null, error: null });
  });

  it('refuses what it cannot read, and says why', () => {
    expect(parsePriceInput('12.345', 'USD').error).toBe('Use at most 2 decimal places.');
    expect(parsePriceInput('15.5', 'JPY').error).toBe('JPY prices have no decimals.');
    expect(parsePriceInput('ask me', 'USD').error).toMatch(/Enter a price/);
    expect(parsePriceInput('99999999999', 'USD').error).toBe('That price is too large.');
  });

  it('goes back into the form as it was typed', () => {
    expect(priceInputFrom(129999, 'USD')).toBe('1299.99');
    expect(priceInputFrom(1500, 'JPY')).toBe('1500');
    expect(priceInputFrom(null, 'USD')).toBe('');
  });
});

describe('the form', () => {
  it('needs a name, a currency code, and a label and value on every spec', () => {
    expect(productDraftErrors(EMPTY_PRODUCT_DRAFT).name).toBe('Give the product a name.');
    expect(productDraftErrors({ ...EMPTY_PRODUCT_DRAFT, name: 'Door', currency: 'dollars' }).currency).toMatch(/three-letter/);
    expect(
      productDraftErrors({ ...EMPTY_PRODUCT_DRAFT, name: 'Door', specs: [{ key: 'k', label: 'Wood', value: '' }] }).specs,
    ).toMatch(/label and a value/);
    expect(Object.values(productDraftErrors({ ...EMPTY_PRODUCT_DRAFT, name: 'Door' }))).toEqual([null, null, null, null]);
  });

  it('moves one item and leaves the rest in order', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});

describe('who may do what', () => {
  it('lets only a business profile create products', () => {
    expect(canCreateProduct({ profileType: 'business' })).toBe(true);
    expect(canCreateProduct({ profileType: 'individual' })).toBe(false);
    expect(canCreateProduct(undefined)).toBe(false);
  });

  it('lets only the listing business manage a product', () => {
    expect(canManageProduct('p-studio', { businessProfileId: 'p-studio' })).toBe(true);
    expect(canManageProduct('p-other-business', { businessProfileId: 'p-studio' })).toBe(false);
    expect(canManageProduct(undefined, { businessProfileId: 'p-studio' })).toBe(false);
  });
});

// ─── 3. Writing ─────────────────────────────────────────────────────────

describe('creating a product', () => {
  const input = {
    businessProfileId: 'p-studio',
    fields: { name: 'Lamp', description: null, category: 'Lighting', priceCents: null, currency: 'USD', available: true },
    mediaUris: ['file:///one.jpg', 'file:///two.jpg'],
    specs: [{ label: 'Bulb', value: 'E26' }],
  };

  it('uploads images under the account, never the business profile, and writes them in order', async () => {
    const id = await createProduct(asAuthUserId(ACCOUNT), input);

    expect(db.uploads).toHaveLength(2);
    for (const upload of db.uploads) {
      expect(upload.bucket).toBe('post-media');
      expect(upload.path).toMatch(new RegExp(`^products/${ACCOUNT}/`));
      expect(upload.path).not.toContain('p-studio');
    }
    const product = db.tables.products!.find((p) => p.id === id)!;
    expect(product).toMatchObject({ business_profile_id: 'p-studio', name: 'Lamp', price_cents: null });
    const media = db.tables.product_media!.filter((m) => m.product_id === id);
    expect(media.map((m) => [m.sort_order, m.url])).toEqual([
      [0, `https://cdn.example/post-media/${db.uploads[0]!.path}`],
      [1, `https://cdn.example/post-media/${db.uploads[1]!.path}`],
    ]);
    expect(db.tables.product_specs!.filter((s) => s.product_id === id)).toEqual([
      expect.objectContaining({ label: 'Bulb', value: 'E26', sort_order: 0 }),
    ]);
  });

  it('writes nothing when a photo will not upload', async () => {
    db.failUploads = { message: 'new row violates row-level security policy' };
    await expect(createProduct(asAuthUserId(ACCOUNT), input)).rejects.toThrow("A photo couldn't be uploaded.");
    expect(db.writes).toEqual([]);
  });

  it('takes the product back if its media cannot be written, so no half-made product is left', async () => {
    db.failNext = { table: 'product_media', kind: 'insert', error: { message: 'boom' } };
    await expect(createProduct(asAuthUserId(ACCOUNT), input)).rejects.toEqual({ message: 'boom' });
    expect(db.tables.products!.map((p) => p.name)).toEqual(['Oak door']);
  });
});

describe('reordering', () => {
  const stored = [
    { id: 'm1', url: 'one', mediaType: 'photo' as const, sortOrder: 0 },
    { id: 'm2', url: 'two', mediaType: 'photo' as const, sortOrder: 1 },
    { id: 'm3', url: 'three', mediaType: 'photo' as const, sortOrder: 2 },
  ];

  it('rewrites only the sort orders that changed, keeping every row', () => {
    expect(mediaChanges(stored, ['three', 'one', 'two'])).toEqual({
      inserts: [],
      moves: [
        { id: 'm3', sortOrder: 0 },
        { id: 'm1', sortOrder: 1 },
        { id: 'm2', sortOrder: 2 },
      ],
      removals: [],
    });
    expect(mediaChanges(stored, ['one', 'two', 'three'])).toEqual({ inserts: [], moves: [], removals: [] });
  });

  it('adds new images and removes the ones taken out', () => {
    expect(mediaChanges(stored, ['two', 'new'])).toEqual({
      inserts: [{ url: 'new', sortOrder: 1 }],
      moves: [{ id: 'm2', sortOrder: 0 }],
      removals: ['m1', 'm3'],
    });
  });

  it('does the same for specs, updating what changed', () => {
    const specs = [
      { id: 's1', label: 'Wood', value: 'Oak', sortOrder: 0 },
      { id: 's2', label: 'Size', value: 'Small', sortOrder: 1 },
    ];
    expect(specChanges(specs, [{ id: 's2', label: 'Size', value: 'Large' }, { label: 'Finish', value: 'Oil' }])).toEqual({
      inserts: [{ label: 'Finish', value: 'Oil', sortOrder: 1 }],
      updates: [{ id: 's2', label: 'Size', value: 'Large', sortOrder: 0 }],
      removals: ['s1'],
    });
  });
});

// ─── 4. The page ────────────────────────────────────────────────────────

const images = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('img')).filter((img) => (img.getAttribute('aria-label') ?? '').startsWith('Oak door, photo'));

describe('the product page', () => {
  it('shows the photos in sort order, the first being the representative image', async () => {
    const el = await mount(<ProductScreen />);
    expect(images(el).map((img) => img.getAttribute('src'))).toEqual([
      'https://cdn.example/front.jpg',
      'https://cdn.example/detail.jpg',
      'https://cdn.example/side.jpg',
    ]);
    expect(images(el)[0]!.getAttribute('aria-label')).toBe('Oak door, photo 1 of 3');
    expect(el.textContent).toContain('1 / 3');
  });

  it('shows what it is: name, category, description, price and specs in order', async () => {
    const el = await mount(<ProductScreen />);
    expect(mockHeader.title).toBe('Oak door');
    const text = el.textContent ?? '';
    expect(text).toContain('Product · Doors');
    expect(text).toContain('Solid white oak, hand finished.');
    expect(byLabel(el, 'Price, $1,299.99')).not.toBeNull();
    expect(text.indexOf('Material')).toBeLessThan(text.indexOf('Size'));
    expect(byLabel(el, 'Material, White oak')).not.toBeNull();
  });

  it('lists every project that uses it, each routing to that project', async () => {
    const el = await mount(<ProductScreen />);
    const section = byLabel(el, 'Used in projects')!;
    expect(section.textContent).toContain('Barn conversion');
    expect(section.textContent).toContain('Renovation · 2025');
    expect(section.textContent).toContain('City loft');
    // Newest first.
    expect(section.textContent!.indexOf('City loft')).toBeLessThan(section.textContent!.indexOf('Barn conversion'));

    await click(buttons(section).find((b) => b.textContent?.includes('Barn conversion')));
    expect(mockRouter.push).toHaveBeenCalledWith('/project/pj-barn');
    await click(buttons(section).find((b) => b.textContent?.includes('City loft')));
    expect(mockRouter.push).toHaveBeenCalledWith('/project/pj-loft');
  });

  it('routes to the business that lists it', async () => {
    const el = await mount(<ProductScreen />);
    await click(buttons(byLabel(el, 'Listed by')!).find((b) => b.textContent?.includes('Oak Studio')));
    expect(mockRouter.push).toHaveBeenCalledWith('/user/oak_studio');
  });

  it('says so when no project uses it yet', async () => {
    db.tables.project_products = [];
    const el = await mount(<ProductScreen />);
    expect(byLabel(el, 'Used in projects')!.textContent).toContain('Not in any projects yet');
  });

  it('says the projects could not be read, with a way to try again, rather than that there are none', async () => {
    db.failNext = { table: 'project_products', kind: 'select', error: { message: 'boom' } };
    const el = await mount(<ProductScreen />);
    const section = byLabel(el, 'Used in projects')!;
    expect(section.textContent).toContain("Couldn't load the projects that use it.");
    expect(section.textContent).not.toContain('Not in any projects yet');
    await click(byText(section, 'Try again'));
    expect(byLabel(el, 'Used in projects')!.textContent).toContain('Barn conversion');
  });

  it('renders fully for someone signed out, offering a way in instead of Save', async () => {
    mockActing.profileId = undefined;
    mockActing.authUserId = undefined;
    mockActing.status = 'signed-out';
    mockAuth.status = 'signed-out';
    const el = await mount(<ProductScreen />);

    expect(images(el)).toHaveLength(3);
    expect(el.textContent).toContain('Oak door');
    expect(byLabel(el, 'Material, White oak')).not.toBeNull();
    expect(byLabel(el, 'Used in projects')!.textContent).toContain('Barn conversion');
    expect(byText(el, 'Sign up to save')).toBeTruthy();
    expect(byText(el, 'Share')).toBeTruthy();
    expect(byLabel(el, 'Manage product')).toBeNull();
    // Saves were never asked for: there is no profile to read them as.
    expect(db.writes).toEqual([]);
  });

  it('shows no price and no buy affordance for a product without a price', async () => {
    db.tables.products![0]!.price_cents = null;
    const el = await mount(<ProductScreen />);
    expect(el.querySelector('[aria-label^="Price"]')).toBeNull();
    expect(el.textContent).not.toMatch(/\$/);
    expect(el.textContent).not.toMatch(/buy|cart|checkout|order|purchase|quote/i);
  });

  it('never offers to buy, even with a price', async () => {
    const el = await mount(<ProductScreen />);
    expect(el.textContent).not.toMatch(/buy|cart|checkout|order|purchase|quote/i);
    expect(buttons(el).map((b) => b.textContent)).toEqual(expect.not.arrayContaining(['Buy now', 'Add to cart']));
  });

  it('marks a product its business took down', async () => {
    db.tables.products![0]!.available = false;
    const el = await mount(<ProductScreen />);
    expect(byLabel(el, 'No longer available')).not.toBeNull();
  });

  it('says a product that is gone is not found, with somewhere to go', async () => {
    mockParams.current = { id: 'pd-missing' };
    const el = await mount(<ProductScreen />);
    expect(el.textContent).toContain('Product not found');
    await click(byText(el, 'Go to OneTag'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)');
  });

  it('saves it as the active profile', async () => {
    const el = await mount(<ProductScreen />);
    await click(byText(el, 'Save'));
    expect(db.tables.saves).toEqual([expect.objectContaining({ profile_id: 'p-studio', saved_product_id: 'pd-door' })]);
    expect(byText(el, 'Saved')).toBeTruthy();
  });
});

// ─── 5. Managing ────────────────────────────────────────────────────────

describe('managing a product', () => {
  it('shows no edit control to a business that does not list it', async () => {
    mockActing.profileId = 'p-other-business';
    mockActing.profile = { id: 'p-other-business', username: 'other', profileType: 'business' };
    const el = await mount(<ProductScreen />);
    expect(byLabel(el, 'Manage product')).toBeNull();
    expect(el.textContent).not.toContain('Edit product');
  });

  it('gives the listing business edit, availability and delete', async () => {
    const el = await mount(<ProductScreen />);
    await click(byLabel(el, 'Manage product'));
    expect(byText(el, 'Edit product')).toBeTruthy();
    expect(byText(el, 'Delete product')).toBeTruthy();
    await click(byText(el, 'Edit product'));
    expect(mockRouter.push).toHaveBeenCalledWith('/product/pd-door/edit');
  });

  it('says that tags pointing at it stop working before deleting, and deletes only on confirmation', async () => {
    const el = await mount(<ProductScreen />);
    await click(byLabel(el, 'Manage product'));
    await click(byText(el, 'Delete product'));

    const [title, body, actions] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe('Delete Oak door?');
    expect(body).toMatch(/Any tag pointing at it stops working for good, including one already printed/);
    expect(body).toMatch(/mark it unavailable instead/);
    expect(db.tables.products).toHaveLength(1);

    await act(async () => {
      (actions as { text: string; onPress?: () => void }[]).find((a) => a.text === 'Delete permanently')!.onPress!();
    });
    await settle();
    expect(db.tables.products).toHaveLength(0);
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('marks it unavailable, the softer alternative', async () => {
    const el = await mount(<ProductScreen />);
    await click(byLabel(el, 'Manage product'));
    await click(byLabel(el, 'Mark unavailable'));
    expect(db.tables.products![0]!.available).toBe(false);
    expect(byLabel(el, 'No longer available')).not.toBeNull();
  });

  it('names the consequence in the confirmation copy itself', () => {
    expect(deleteProductConfirm({ name: 'Lamp' }).body).toMatch(/tag pointing at it stops working/);
  });
});

// ─── 6. Create and edit ─────────────────────────────────────────────────

describe('adding a product', () => {
  it('turns an individual profile away rather than handing it a form the database would refuse', async () => {
    mockActing.profileId = 'p-ana';
    mockActing.profile = { id: 'p-ana', username: 'ana', profileType: 'individual' };
    const el = await mount(<CreateProductScreen />);
    expect(el.textContent).toContain('Products belong to business profiles');
    expect(byLabel(el, 'Name')).toBeNull();
  });

  it('creates it as the business, with photos filed under the account, and opens it', async () => {
    mockPick.mockResolvedValue({ status: 'selected', media: { uri: 'file:///lamp.jpg', width: 10, height: 10, mediaType: 'image' } });
    const el = await mount(<CreateProductScreen />);

    expect((byLabel(el, 'Save') as HTMLButtonElement).disabled).toBe(true);
    await click(byLabel(el, 'Add a photo'));
    await type(el, 'Name', 'Walnut lamp');
    await type(el, 'Price', '249');
    await click(byLabel(el, 'Save'));

    const created = db.tables.products!.find((p) => p.name === 'Walnut lamp')!;
    expect(created).toMatchObject({ business_profile_id: 'p-studio', price_cents: 24900, currency: 'USD' });
    expect(db.uploads.map((u) => u.path)).toEqual([expect.stringMatching(new RegExp(`^products/${ACCOUNT}/`))]);
    expect(mockRouter.replace).toHaveBeenCalledWith(`/product/${created.id}`);
  });
});

describe('editing a product', () => {
  it('keeps the new photo order once saved and read again', async () => {
    const el = await mount(<EditProductScreen />);
    expect(byLabel(el, 'Photo 1 of 3, the cover')).not.toBeNull();

    // Make the third photo the cover.
    await click(byLabel(el, 'Photo 3 of 3'));
    await click(byText(el, 'Make it the cover'));
    await click(byLabel(el, 'Save'));
    expect(mockRouter.back).toHaveBeenCalled();

    const order = db.tables.product_media!
      .filter((m) => m.product_id === 'pd-door')
      .sort((a, b) => (a.sort_order as number) - (b.sort_order as number))
      .map((m) => m.url);
    expect(order).toEqual(['https://cdn.example/side.jpg', 'https://cdn.example/front.jpg', 'https://cdn.example/detail.jpg']);
    // Only sort orders were written: no photo was deleted or uploaded again.
    expect(db.uploads).toEqual([]);
    expect(db.writes.filter((w) => w.table === 'product_media').every((w) => w.kind === 'update')).toBe(true);

    // The page, reading afresh, shows the new cover first.
    act(() => root!.unmount());
    root = null;
    client.clear();
    const page = await mount(<ProductScreen />);
    expect(images(page)[0]!.getAttribute('src')).toBe('https://cdn.example/side.jpg');
  });

  it('keeps Save off until something changes', async () => {
    const el = await mount(<EditProductScreen />);
    expect((byLabel(el, 'Save') as HTMLButtonElement).disabled).toBe(true);
    await type(el, 'Name', 'Oak door, tall');
    expect((byLabel(el, 'Save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('gives the form only to the business that lists it', async () => {
    mockActing.profileId = 'p-other-business';
    const el = await mount(<EditProductScreen />);
    expect(el.textContent).toContain("You can't edit this product");
    expect(byLabel(el, 'Name')).toBeNull();
  });
});
