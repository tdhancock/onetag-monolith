/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/ExploreScreen.test.tsx
//
// The Explore tab, mounted: a light search bar (ONE-71) over the two-column
// discovery grid of posts, products and projects (ONE-47); People and
// Hashtags under mono headers while typing, with Follow inline; Cancel
// clearing back to the grid; and the loading, empty, paging and no-results
// states. Plus the grid's geometry and routing, and search across profiles,
// posts, products and projects in tabs (ONE-48).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  const slot = (C: unknown) =>
    C == null ? null : React.isValidElement(C) ? C : React.createElement(C as React.FC);
  const FlatList = (props: {
    data: unknown[];
    renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    keyExtractor: (item: unknown) => string;
    ListEmptyComponent?: unknown;
    ListHeaderComponent?: unknown;
    ListFooterComponent?: unknown;
    onEndReached?: () => void;
  }) =>
    React.createElement(
      'div',
      { 'data-list': 'true' },
      slot(props.ListHeaderComponent),
      props.data.length === 0
        ? slot(props.ListEmptyComponent)
        : props.data.map((item, index) =>
            React.createElement(React.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index })),
          ),
      slot(props.ListFooterComponent),
      // The end of the list, reached on demand.
      props.onEndReached ? React.createElement('button', { 'data-end': 'true', onClick: props.onEndReached }) : null,
    );
  const ScrollView = (props: { children?: React.ReactNode }) => React.createElement('div', { 'data-scroll': 'true' }, props.children);
  return {
    ...shim,
    FlatList,
    ScrollView,
    RefreshControl: () => null,
    Dimensions: { get: () => ({ width: 376, height: 812 }) },
  };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('expo-image', () => require('../support/expoImageStub'));
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

// ─── 2. Mock the data layer ─────────────────────────────────────────────

// Stable across renders, as the real one is (a useCallback in features/blocks).
const mockBlocked = new Set<string>();
const mockApp = { isUserBlocked: (u: string) => mockBlocked.has(u) };
jest.mock('../../store/AppContext.native', () => ({ useApp: () => mockApp }));

const state = {
  following: new Set<string>(),
  hashtags: { data: [{ tag: 'kitchens', postCount: 12 }, { tag: 'decks', postCount: 1 }], isLoading: false, refetch: jest.fn(() => Promise.resolve()) },
};
const mockToggle = jest.fn();
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({ profile: { username: 'me' }, profileId: 'p-me' }),
  useFollowState: () => ({ isFollowing: (u: string) => state.following.has(u), isRequested: () => false }),
  useToggleFollow: () => ({ toggle: mockToggle, isPending: false }),
}));

// Search results (ONE-48): each hook records the term and category it was
// given, and answers from `results` whatever the term, unless told to find
// nothing.
const results = {
  profiles: [] as Record<string, unknown>[],
  posts: [] as Record<string, unknown>[],
  products: [] as Record<string, unknown>[],
  projects: [] as Record<string, unknown>[],
};
const mockSearchCalls: { type: string; term: string; category?: string | null }[] = [];
const answer = (type: keyof typeof results, term: string, category?: string | null) => {
  mockSearchCalls.push({ type, term, category });
  return { data: term ? results[type] : undefined, isPending: !term, isFetching: false };
};
jest.mock('../../features/search', () => ({
  useProfileResultsQuery: (t: string) => answer('profiles', t),
  usePostResultsQuery: (t: string) => answer('posts', t),
  useProductResultsQuery: (t: string, c: string | null) => answer('products', t, c),
  useProjectResultsQuery: (t: string, c: string | null) => answer('projects', t, c),
}));
const defaultResults = () => ({
  profiles: [{ id: 'p-ana', username: 'ana', name: 'Ana Silva', avatarUrl: null, isVerified: false, profileType: 'individual', isPrivate: false }],
  posts: [{ id: 'po-1', content: 'Kitchen reveal\nmore', imageUrl: null, mediaType: 'text', authorUsername: 'ana', authorAvatarUrl: null }],
  products: [
    { id: 'pd-1', name: 'Oak Lamp', category: 'Lighting', imageUrl: null, businessUsername: 'oakco', businessName: 'Oak Co' },
    { id: 'pd-2', name: 'Oak Stool', category: 'Seating', imageUrl: null, businessUsername: 'oakco', businessName: 'Oak Co' },
  ],
  projects: [{ id: 'pj-1', name: 'Loft', category: 'Interior', coverUrl: null, ownerUsername: 'ana' }],
});
// The interest filter's list (ONE-49), fixed.
jest.mock('../../features/interests', () => ({
  useInterestsQuery: () => ({ data: [{ slug: 'custom-homes', name: 'Custom Homes' }, { slug: 'vehicle-builds', name: 'Vehicle Builds' }] }),
}));
jest.mock('../../features/hashtags', () => ({ useHashtagsQuery: () => state.hashtags }));

// The grid's infinite query (ONE-47), steered per test.
type Cell = Record<string, unknown> & { key: string };
const cell = (kind: string, id: string, extra: Record<string, unknown> = {}): Cell => ({
  kind, id, key: `${kind}:${id}`, ownerProfileId: 'p-ana', ownerUsername: 'ana',
  title: `${kind} ${id}`, imageUrl: null, mediaType: kind === 'post' ? 'text' : 'image', tagCount: 0, score: 1, ...extra,
});
const mockExploreInterests: (string | null)[] = [];
const explore = {
  pages: [[] as Cell[]],
  filteredPages: [[] as Cell[]],
  isPending: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: jest.fn(),
  refetch: jest.fn(() => Promise.resolve()),
};
const defaultCells = () => [
  cell('post', '1', { title: 'Post 1\nmore' }),
  cell('product', 'pd-1', { title: 'Lamp', imageUrl: 'https://x/lamp.jpg' }),
  cell('project', 'pj-1', { title: 'Loft' }),
  cell('post', '2', { mediaType: 'image', imageUrl: 'https://x/2.jpg', tagCount: 3 }),
];
jest.mock('../../features/explore', () => ({
  useExploreQuery: (_viewer: string, interest: string | null) => {
    mockExploreInterests.push(interest ?? null);
    const pages = interest ? explore.filteredPages : explore.pages;
    return { ...explore, data: explore.isPending ? undefined : { pages } };
  },
  flattenExplorePages: (pages: { key: string }[][]) => {
    const seen = new Set<string>();
    return pages.flat().filter(i => (seen.has(i.key) ? false : (seen.add(i.key), true)));
  },
}));

import SearchScreen from '../../app/(tabs)/search';
import { Keyboard } from 'react-native';
import {
  exploreCellLabel,
  exploreKindLabel,
  exploreRoute,
  exploreTileGapRight,
  exploreTileSize,
  categoriesOf,
  categoryFilterLabel,
  hashtagPostCount,
  matchingHashtags,
  noResultsLabel,
} from '../../lib/screens/explore';
import { color } from '../../theme/tokens';

// ─── 3. Helpers ─────────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<SearchScreen />); });
  return container;
}

beforeEach(() => {
  state.following = new Set();
  state.hashtags.isLoading = false;
  mockBlocked.clear();
  mockExploreInterests.length = 0;
  Object.assign(explore, { pages: [defaultCells()], filteredPages: [[]], isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false });
  Object.assign(results, defaultResults());
  mockSearchCalls.length = 0;
  [mockPush, mockToggle, explore.fetchNextPage, explore.refetch].forEach(m => m.mockClear());
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const button = (el: HTMLElement, label: string) =>
  el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const buttonWithText = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find(b => b.textContent === text) as HTMLButtonElement | undefined;

const rgb = (hex: string) => {
  const probe = document.createElement('div');
  probe.style.color = hex;
  return probe.style.color;
};

const search = (el: HTMLElement) => el.querySelector('input[aria-label="Search"]') as HTMLInputElement;

/** Focuses the field and types, then waits out the 300ms debounce. */
const typeQuery = async (el: HTMLElement, value: string) => {
  const input = search(el);
  act(() => input.focus());
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 350)); });
};

// ─── 4. At rest: the discovery grid (ONE-47) ────────────────────────────

const cells = (el: HTMLElement) => Array.from(el.querySelectorAll('button[data-testid^="explore-cell-"]')) as HTMLElement[];

describe('Explore — the discovery grid', () => {
  it('shows a light search field over a grid mixing posts, products and projects', async () => {
    const el = await mount();
    const input = search(el);
    expect(input.getAttribute('placeholder')).toBe('Search');
    expect(input.style.backgroundColor).toBe(rgb(color.bgPanel));
    expect(cells(el)).toHaveLength(4);
    expect(buttonWithText(el, 'Cancel')).toBeUndefined();
  });

  it('says what each cell is, without tapping it', async () => {
    const el = await mount();
    expect(cells(el).map(c => c.querySelector('span[style*="uppercase"]')?.textContent)).toEqual([
      'Post', 'Product', 'Project', 'Post',
    ]);
    expect(button(el, 'Product: Lamp')).not.toBeNull();
  });

  it('lays square cells two to a row, with a 1pt gap and none at the row end', async () => {
    const el = await mount();
    const [first, second] = cells(el);
    expect(first.style.width).toBe(first.style.height);
    expect(first.style.marginRight).toBe('1px');
    expect(second.style.marginRight).toBe('0px');
  });

  it('shows a text post\'s opening lines on the panel', async () => {
    const el = await mount();
    expect(cells(el)[0].textContent).toContain('Post 1');
  });

  it('shows the tag count on a post with embedded tags', async () => {
    const el = await mount();
    expect(cells(el)[3].textContent).toContain('3 TAGGED');
    expect(cells(el)[0].textContent).not.toContain('TAGGED');
  });

  it('opens each item on its own screen', async () => {
    const el = await mount();
    for (const c of cells(el)) act(() => (c as HTMLButtonElement).click());
    expect(mockPush.mock.calls.map(call => call[0])).toEqual(['/post/1', '/product/pd-1', '/project/pj-1', '/post/2']);
  });

  it('leaves out an account blocked since the page loaded', async () => {
    mockBlocked.add('ana');
    const el = await mount();
    expect(cells(el)).toHaveLength(0);
  });

  it('shows each item once across pages', async () => {
    explore.pages = [[cell('post', '1'), cell('post', '2')], [cell('post', '2'), cell('product', 'pd-1')]];
    const el = await mount();
    expect(cells(el).map(c => c.getAttribute('data-testid'))).toEqual([
      'explore-cell-post:1', 'explore-cell-post:2', 'explore-cell-product:pd-1',
    ]);
  });

  it('asks for the next page at the end, only when there is one and none is in flight', async () => {
    explore.hasNextPage = true;
    const el = await mount();
    act(() => (el.querySelector('button[data-end]') as HTMLButtonElement).click());
    expect(explore.fetchNextPage).toHaveBeenCalledTimes(1);

    act(() => root!.unmount());
    root = null;
    explore.fetchNextPage.mockClear();
    explore.isFetchingNextPage = true;
    const busy = await mount();
    act(() => (busy.querySelector('button[data-end]') as HTMLButtonElement).click());
    explore.isFetchingNextPage = false;
    explore.hasNextPage = false;
    expect(explore.fetchNextPage).not.toHaveBeenCalled();
  });

  it('reserves a slot above the grid for the interest filter row', async () => {
    const el = await mount();
    const slot = el.querySelector('[data-testid="explore-filter-slot"]')!;
    expect(slot).not.toBeNull();
    expect(slot.compareDocumentPosition(cells(el)[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers a next step on an empty platform rather than a blank grid', async () => {
    explore.pages = [[]];
    const el = await mount();
    expect(el.textContent).toContain('Nothing to explore yet');
    expect(el.textContent).toContain('Follow people');
    act(() => buttonWithText(el, 'Create a post')!.click());
    expect(mockPush).toHaveBeenCalledWith('/compose');
  });

  it('shows a skeleton grid while the first page loads', async () => {
    explore.isPending = true;
    const el = await mount();
    expect(el.querySelectorAll('div[data-animated="true"]').length).toBeGreaterThanOrEqual(6);
  });

  it('offers Retry when the grid fails to load', async () => {
    explore.isError = true;
    explore.pages = [];
    const el = await mount();
    expect(el.textContent).toContain("Couldn't load Explore");
    act(() => buttonWithText(el, 'Retry')!.click());
    expect(explore.refetch).toHaveBeenCalled();
  });
});

// ─── 5. Searching (ONE-48) ──────────────────────────────────────────────

/** Mono labels outside a button: the section headers. */
const sectionHeaders = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('span'))
    .filter(sp => sp.style.textTransform === 'uppercase' && !sp.closest('button'))
    .map(h => h.textContent);

describe('Explore — searching', () => {
  it('shows every type under All, with Follow inline on profiles', async () => {
    const el = await mount();
    await typeQuery(el, 'k');
    expect(sectionHeaders(el)).toEqual(['Profiles', 'Hashtags', 'Posts', 'Products', 'Projects']);
    expect(el.textContent).toContain('Ana Silva');
    expect(el.textContent).toContain('#kitchens');
    expect(el.textContent).toContain('Kitchen reveal');
    expect(el.textContent).toContain('Oak Lamp');
    expect(el.textContent).toContain('Loft');

    act(() => buttonWithText(el, 'Follow')!.click());
    expect(mockToggle).toHaveBeenCalledWith({ userId: 'p-ana', username: 'ana', isPrivate: false });
  });

  it('shows a product under Products as well as All', async () => {
    const el = await mount();
    await typeQuery(el, 'oak');
    act(() => buttonWithText(el, 'Products')!.click());
    expect(sectionHeaders(el)).toEqual(['Products']);
    expect(el.textContent).toContain('Oak Lamp');
    expect(el.textContent).not.toContain('Ana Silva');
  });

  it('shows a few of each on All, with a way into the full tab', async () => {
    results.profiles = ['a', 'b', 'c', 'd'].map(u => ({ id: u, username: u, name: u, avatarUrl: null, isVerified: false, profileType: 'individual', isPrivate: false }));
    const el = await mount();
    await typeQuery(el, 'x');
    expect(el.querySelectorAll('button[aria-label^="View "]')).toHaveLength(3);
    act(() => button(el, 'See all profiles')!.click());
    expect(el.querySelectorAll('button[aria-label^="View "]')).toHaveLength(4);
  });

  it('narrows products to a category from the filter sheet', async () => {
    const el = await mount();
    await typeQuery(el, 'oak');
    act(() => buttonWithText(el, 'Products')!.click());
    act(() => buttonWithText(el, 'Category')!.click());
    expect(el.textContent).toContain('Filter by category');
    const sheet = el.querySelector('[data-modal]') as HTMLElement;
    const seating = Array.from(sheet.querySelectorAll('button')).find(b => b.textContent?.includes('Seating'))!;
    act(() => seating.click());
    expect(mockSearchCalls.filter(c => c.type === 'products').pop()).toEqual({ type: 'products', term: 'oak', category: 'Seating' });
    expect(buttonWithText(el, 'Category: Seating')).toBeDefined();
  });

  it('waits for typing to pause before searching', async () => {
    const el = await mount();
    const input = search(el);
    act(() => input.focus());
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    for (const value of ['k', 'ki', 'kit']) {
      act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    await act(async () => { await new Promise(r => setTimeout(r, 350)); });
    const terms = new Set(mockSearchCalls.map(c => c.term));
    expect(terms).toEqual(new Set(['', 'kit']));
  });

  it('opens every kind of result on its own screen', async () => {
    const el = await mount();
    await typeQuery(el, 'k');
    act(() => button(el, "View ana's profile")!.click());
    act(() => (el.querySelector('button[aria-label^="Post by @ana"]') as HTMLButtonElement).click());
    act(() => (el.querySelector('button[aria-label^="Product: Oak Lamp"]') as HTMLButtonElement).click());
    act(() => (el.querySelector('button[aria-label^="Project: Loft"]') as HTMLButtonElement).click());
    expect(mockPush.mock.calls.map(c => c[0])).toEqual(['/user/ana', '/post/po-1', '/product/pd-1', '/project/pj-1']);
  });

  it('leaves out an account blocked since the results loaded', async () => {
    mockBlocked.add('ana');
    const el = await mount();
    await typeQuery(el, 'k');
    expect(el.textContent).not.toContain('Ana Silva');
    expect(el.textContent).not.toContain('Kitchen reveal');
    expect(el.textContent).not.toContain('Loft');
    expect(el.textContent).toContain('Oak Lamp');
  });

  it('reads "Following" in outline for someone already followed', async () => {
    state.following = new Set(['ana']);
    const el = await mount();
    await typeQuery(el, 'an');
    expect(buttonWithText(el, 'Following')).toBeDefined();
  });

  it('says so when nothing matches, and suggests broadening', async () => {
    Object.assign(results, { profiles: [], posts: [], products: [], projects: [] });
    const el = await mount();
    await typeQuery(el, 'zzz');
    expect(el.textContent).toContain('No results for "zzz"');
    expect(el.textContent).toContain('Try fewer words');
    expect(cells(el)).toHaveLength(0);
  });

  it('brings the grid back when the input is cleared, distinct from no results', async () => {
    const el = await mount();
    await typeQuery(el, 'k');
    expect(cells(el)).toHaveLength(0);
    await typeQuery(el, '');
    expect(cells(el)).toHaveLength(4);
    expect(el.textContent).not.toContain('No results');
  });

  it('Cancel clears the query, dismisses the keyboard and brings the grid back', async () => {
    const el = await mount();
    await typeQuery(el, 'k');
    act(() => button(el, 'Cancel search')!.click());
    expect(search(el).value).toBe('');
    expect(Keyboard.dismiss).toHaveBeenCalled();
    expect(cells(el)).toHaveLength(4);
  });
});

// ─── 6. Pure rules ──────────────────────────────────────────────────────

describe('Explore — grid and result rules', () => {
  it('sizes two cells and one 1pt gap to the full width', () => {
    expect(exploreTileSize(375) * 2 + 1).toBe(375);
  });

  it('puts a gap after the first cell in each row, none after the second', () => {
    expect([0, 1, 2, 3].map(exploreTileGapRight)).toEqual([1, 0, 1, 0]);
  });

  it('routes each kind to its own screen', () => {
    expect(exploreRoute({ kind: 'post', id: 'a b' })).toBe('/post/a%20b');
    expect(exploreRoute({ kind: 'product', id: 'pd' })).toBe('/product/pd');
    expect(exploreRoute({ kind: 'project', id: 'pj' })).toBe('/project/pj');
  });

  it('labels each kind, and announces a cell with its tags', () => {
    expect(['post', 'product', 'project'].map(k => exploreKindLabel(k as 'post'))).toEqual(['Post', 'Product', 'Project']);
    expect(exploreCellLabel({ kind: 'post', title: 'x', ownerUsername: 'ana', tagCount: 2 })).toBe('Post by @ana, 2 tagged');
    expect(exploreCellLabel({ kind: 'project', title: 'Loft', ownerUsername: 'b', tagCount: 0 })).toBe('Project: Loft');
  });

  it('matches hashtags case-insensitively, and nothing for a blank query', () => {
    const tags = [{ tag: 'Kitchens', postCount: 3 }, { tag: 'decks', postCount: 1 }];
    expect(matchingHashtags(tags, 'kit').map(t => t.tag)).toEqual(['Kitchens']);
    expect(matchingHashtags(tags, '  ')).toEqual([]);
  });

  it('counts posts in the singular and plural', () => {
    expect(hashtagPostCount(1)).toBe('1 post');
    expect(hashtagPostCount(1204)).toBe('1,204 posts');
  });

  it('quotes the trimmed query when nothing matches', () => {
    expect(noResultsLabel(' deck ')).toBe('No results for "deck"');
  });

  it('offers the categories present in the results, once each, alphabetically', () => {
    expect(categoriesOf([{ category: 'Seating' }, { category: null }, { category: 'Lighting' }, { category: 'Seating' }])).toEqual([
      'Lighting', 'Seating',
    ]);
    expect(categoryFilterLabel(null)).toBe('Category');
    expect(categoryFilterLabel('Seating')).toBe('Category: Seating');
  });
});

// ─── 7. The interest filter (ONE-49) ────────────────────────────────────

describe('Explore — interest filter', () => {
  it('sits in the slot above the grid, leading with All', async () => {
    const el = await mount();
    const slot = el.querySelector('[data-testid="explore-filter-slot"]')!;
    expect(slot.querySelector('button[aria-label="Interest: All, selected"]')).not.toBeNull();
    expect(slot.textContent).toContain('Custom Homes');
  });

  it('narrows the grid on the server, and explains an empty interest with a way back', async () => {
    const el = await mount();
    act(() => button(el, 'Interest: Vehicle Builds')!.click());
    expect(mockExploreInterests[mockExploreInterests.length - 1]).toBe('vehicle-builds');
    expect(el.textContent).toContain('Nothing in Vehicle Builds yet');
    act(() => buttonWithText(el, 'Show all')!.click());
    expect(cells(el)).toHaveLength(4);
  });
});
