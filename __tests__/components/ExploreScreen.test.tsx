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
// states. Plus the grid's geometry and routing.

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
const mockSearchUsers = jest.fn((_q: string) =>
  Promise.resolve([{ id: 'p-ana', username: 'ana', full_name: 'Ana Silva', avatar_url: null }] as unknown[]),
);
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({ profile: { username: 'me' }, profileId: 'p-me' }),
  useFollowState: () => ({ isFollowing: (u: string) => state.following.has(u) }),
  useToggleFollow: () => ({ toggle: mockToggle, isPending: false }),
  searchUsers: (q: string) => mockSearchUsers(q),
}));
jest.mock('../../features/hashtags', () => ({ useHashtagsQuery: () => state.hashtags }));

// The grid's infinite query (ONE-47), steered per test.
type Cell = Record<string, unknown> & { key: string };
const cell = (kind: string, id: string, extra: Record<string, unknown> = {}): Cell => ({
  kind, id, key: `${kind}:${id}`, ownerProfileId: 'p-ana', ownerUsername: 'ana',
  title: `${kind} ${id}`, imageUrl: null, mediaType: kind === 'post' ? 'text' : 'image', tagCount: 0, score: 1, ...extra,
});
const explore = {
  pages: [[] as Cell[]],
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
  useExploreQuery: () => ({ ...explore, data: explore.isPending ? undefined : { pages: explore.pages } }),
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
  Object.assign(explore, { pages: [defaultCells()], isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false });
  [mockPush, mockToggle, mockSearchUsers, explore.fetchNextPage, explore.refetch].forEach(m => m.mockClear());
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

// ─── 5. Searching ───────────────────────────────────────────────────────

describe('Explore — searching', () => {
  it('shows People and Hashtags under mono headers, with Follow inline', async () => {
    const el = await mount();
    await typeQuery(el, 'k');
    // Mono labels outside a button: the section headers, not Follow's label.
    const headers = Array.from(el.querySelectorAll('span')).filter(
      s => s.style.textTransform === 'uppercase' && !s.closest('button'),
    );
    expect(headers.map(h => h.textContent)).toEqual(['People', 'Hashtags']);
    expect(el.textContent).toContain('Ana Silva');
    expect(el.textContent).toContain('#kitchens');
    expect(el.textContent).toContain('12 posts');

    act(() => buttonWithText(el, 'Follow')!.click());
    expect(mockToggle).toHaveBeenCalledWith({ userId: 'p-ana', username: 'ana' });
  });

  it('reads "Following" in outline for someone already followed', async () => {
    state.following = new Set(['ana']);
    const el = await mount();
    await typeQuery(el, 'an');
    expect(buttonWithText(el, 'Following')).toBeDefined();
  });

  it('says so when nothing matches', async () => {
    mockSearchUsers.mockImplementationOnce(() => Promise.resolve([]));
    const el = await mount();
    await typeQuery(el, 'zzz');
    expect(el.textContent).toContain('No results for "zzz"');
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
});
