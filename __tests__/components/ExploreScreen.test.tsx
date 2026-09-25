/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/ExploreScreen.test.tsx
//
// The Explore tab, re-skinned (ONE-71), mounted: a light search bar over the
// white three-column trending grid; People and Hashtags under mono headers
// while typing, with Follow inline; Cancel clearing back to the grid; and the
// loading, empty and no-results states. Plus the grid's geometry.

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
  }) =>
    React.createElement(
      'div',
      { 'data-list': 'true' },
      props.data.length === 0
        ? slot(props.ListEmptyComponent)
        : props.data.map((item, index) =>
            React.createElement(React.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index })),
          ),
    );
  const ScrollView = (props: { children?: React.ReactNode }) => React.createElement('div', { 'data-scroll': 'true' }, props.children);
  return {
    ...shim,
    FlatList,
    ScrollView,
    RefreshControl: () => null,
    Dimensions: { get: () => ({ width: 376, height: 812 }) },
  };
}, { virtual: true });
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
}, { virtual: true });
jest.mock('expo-image', () => require('../support/expoImageStub'), { virtual: true });
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'), { virtual: true });

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }), { virtual: true });

// ─── 2. Mock the data layer ─────────────────────────────────────────────

// Stable across renders, as the real one is (a useCallback in features/blocks).
const mockApp = { isUserBlocked: () => false };
jest.mock('../../store/AppContext.native', () => ({ useApp: () => mockApp }), { virtual: true });

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
}), { virtual: true });
jest.mock('../../features/hashtags', () => ({ useHashtagsQuery: () => state.hashtags }), { virtual: true });

const post = (id: string, extra: Record<string, unknown> = {}) => ({
  id, username: 'ana', avatar: null, content: `Post ${id}\nmore`, media_type: 'text', likes: 0, reposts: 0, replies: 0, ...extra,
});
const mockTrending = jest.fn(() => Promise.resolve([post('1'), post('2', { media_type: 'image', media: 'https://x/2.jpg' }), post('3'), post('4')] as unknown[]));
jest.mock('../../features/posts', () => ({ fetchTrendingPosts: () => mockTrending() }), { virtual: true });

import SearchScreen from '../../app/(tabs)/search';
import { Keyboard } from 'react-native';
import {
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
  mockTrending.mockImplementation(() => Promise.resolve([post('1'), post('2', { media_type: 'image', media: 'https://x/2.jpg' }), post('3'), post('4')]));
  [mockPush, mockToggle, mockSearchUsers].forEach(m => m.mockClear());
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

// ─── 4. At rest ─────────────────────────────────────────────────────────

describe('Explore — at rest', () => {
  it('shows a light search field over the trending grid', async () => {
    const el = await mount();
    const input = search(el);
    expect(input.getAttribute('placeholder')).toBe('Search');
    expect(input.style.backgroundColor).toBe(rgb(color.bgPanel));
    expect(el.querySelectorAll('button[aria-label="Post by ana"]')).toHaveLength(4);
    expect(buttonWithText(el, 'Cancel')).toBeUndefined();
  });

  it('lays square tiles three to a row, with a 1pt gap and none at the row end', async () => {
    const el = await mount();
    const tiles = Array.from(el.querySelectorAll('button[aria-label="Post by ana"]')) as HTMLElement[];
    expect(tiles[0]!.style.width).toBe(tiles[0]!.style.height);
    expect(tiles[0]!.style.marginRight).toBe('1px');
    expect(tiles[2]!.style.marginRight).toBe('0px');
  });

  it('shows a text post\'s first line on the panel', async () => {
    const el = await mount();
    const tile = el.querySelectorAll('button[aria-label="Post by ana"]')[0] as HTMLElement;
    expect(tile.textContent).toBe('Post 1');
  });

  it('opens a post from its tile', async () => {
    const el = await mount();
    act(() => (el.querySelectorAll('button[aria-label="Post by ana"]')[2] as HTMLButtonElement).click());
    expect(mockPush).toHaveBeenCalledWith('/post/3');
  });

  it('shows "Nothing to explore yet" with Create a post when there is nothing', async () => {
    mockTrending.mockImplementation(() => Promise.resolve([]));
    const el = await mount();
    expect(el.textContent).toContain('Nothing to explore yet');
    act(() => buttonWithText(el, 'Create a post')!.click());
    expect(mockPush).toHaveBeenCalledWith('/compose');
  });

  it('shows a skeleton grid while loading', async () => {
    state.hashtags.isLoading = true;
    const el = await mount();
    expect(el.querySelectorAll('div[data-animated="true"]').length).toBeGreaterThanOrEqual(9);
  });

  it('offers Retry when the grid fails to load', async () => {
    mockTrending.mockImplementation(() => Promise.reject(new Error('offline')));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = await mount();
    expect(el.textContent).toContain("Couldn't load Explore");
    mockTrending.mockImplementation(() => Promise.resolve([post('1')]));
    await act(async () => { buttonWithText(el, 'Retry')!.click(); });
    expect(el.querySelectorAll('button[aria-label="Post by ana"]')).toHaveLength(1);
    spy.mockRestore();
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
    expect(el.querySelectorAll('button[aria-label="Post by ana"]')).toHaveLength(4);
  });
});

// ─── 6. Pure rules ──────────────────────────────────────────────────────

describe('Explore — grid and result rules', () => {
  it('sizes three tiles and two 1pt gaps to the full width', () => {
    expect(exploreTileSize(376) * 3 + 2).toBe(376);
  });

  it('puts a gap after every tile but the last in a row', () => {
    expect([0, 1, 2, 3, 4, 5].map(exploreTileGapRight)).toEqual([1, 1, 0, 1, 1, 0]);
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
