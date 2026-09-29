/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/HomeScreen.render.test.tsx
//
// The re-skinned Home tab (ONE-66), mounted: the header, the OneSnap strip
// ahead of the posts, the badges, the loading skeletons, the error state
// with Retry, and the new-account welcome with Follow cards.
//
// PostCard is replaced by a marker (it has its own suites), and every data
// hook is a mock whose return value each test sets, so each state the screen
// can be in is reachable without a query client or a network.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

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
    horizontal?: boolean;
    ListHeaderComponent?: unknown;
    ListEmptyComponent?: unknown;
    ListFooterComponent?: unknown;
    refreshControl?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-list': props.horizontal ? 'horizontal' : 'vertical' },
      props.refreshControl ?? null,
      slot(props.ListHeaderComponent),
      props.data.length === 0
        ? slot(props.ListEmptyComponent)
        : props.data.map((item, index) =>
            React.createElement(React.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index })),
          ),
      slot(props.ListFooterComponent),
    );
  const RefreshControl = (props: { tintColor?: string }) =>
    React.createElement('div', { 'data-refresh-tint': props.tintColor });
  const ActivityIndicator = () => React.createElement('div', { 'data-spinner': 'true' });
  const ScrollView = (props: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-scroll': 'true' }, props.children);
  return { ...shim, FlatList, RefreshControl, ActivityIndicator, ScrollView };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: (props: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-safe-area': 'true' }, props.children),
  };
});
jest.mock('expo-image', () => require('../support/expoImageStub'));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  return { LinearGradient: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));

const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
  // The tab is on screen for as long as it's mounted.
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, []),
}));

// ─── 2. Mock the data layer ─────────────────────────────────────────────

jest.mock('../../components/native/PostCard', () => {
  const React = require('react');
  return (props: { post: { id: string } }) => React.createElement('article', { 'data-post': props.post.id });
});

// One stable context value, as the real provider's memoised one is: fresh
// functions every render would re-run every effect that depends on them.
const mockApp = {
  isUserBlocked: () => false,
  addToast: jest.fn(),
  isStoryViewed: () => false,
  triggerHapticFeedback: jest.fn(),
};
jest.mock('../../store/AppContext.native', () => ({ useApp: () => mockApp }));

const state = {
  following: [] as string[],
  followingSet: new Set<string>(),
  notifications: 0,
  messages: 0,
  suggestions: [] as Record<string, unknown>[],
  feed: {
    data: undefined as undefined | { pages: { id: string }[][] },
    isPending: false,
    isError: false,
    error: null,
    isFetchingNextPage: false,
    hasNextPage: false,
    refetch: jest.fn(() => Promise.resolve()),
    fetchNextPage: jest.fn(),
  },
  reel: { data: [] as unknown[], isPending: false, refetch: jest.fn(() => Promise.resolve()) },
  /** The newest post the feed holds, as the New posts check answers. */
  newest: null as null | { id: string; createdAt: string },
  filteredFeed: { data: { pages: [[]] } as undefined | { pages: { id: string }[][] }, isPending: false },
};
const mockFeedInterests: (string | null)[] = [];

const mockFollowToggle = jest.fn();
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({ profile: { username: 'me' }, profileId: 'p-me', authUserId: 'a-me' }),
  useFollowState: () => ({
    following: state.following,
    isFollowing: (username: string) => state.followingSet.has(username),
    isRequested: () => false,
  }),
  useToggleFollow: () => ({ toggle: mockFollowToggle }),
  profileKeys: { all: ['profiles'] },
  getSmartUserSuggestions: () => Promise.resolve(state.suggestions),
}));
jest.mock('../../lib/realtimeBridge', () => ({ useRealtimeSync: jest.fn() }));
jest.mock('../../features/notifications', () => ({
  useUnreadNotificationCount: () => state.notifications,
}));
jest.mock('../../features/messages', () => ({
  useUnreadMessageCount: () => state.messages,
}));
jest.mock('../../features/stories', () => ({
  useStoriesQuery: () => state.reel,
  useMyStoriesQuery: () => ({ data: [] }),
  useStoriesRealtime: jest.fn(),
  storyKeys: { lists: () => ['stories', 'list'] },
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }),
}));
// The interest filter's list (ONE-49), fixed.
jest.mock('../../features/interests', () => ({
  useInterestsQuery: () => ({ data: [{ slug: 'custom-homes', name: 'Custom Homes' }, { slug: 'vehicle-builds', name: 'Vehicle Builds' }] }),
}));
jest.mock('../../features/posts', () => ({
  // Records the interest it was asked for (ONE-49); a filtered feed answers
  // from `filteredFeed`.
  useFeedQuery: (_id: unknown, interest?: string | null) => {
    mockFeedInterests.push(interest ?? null);
    return interest ? { ...state.feed, ...state.filteredFeed } : state.feed;
  },
  feedPosts: (data?: { pages: { id: string }[][] }) => (data ? data.pages.flat() : []),
  useNewestFeedPostQuery: () => ({ data: state.newest }),
  postKeys: { all: ['posts'], feed: () => ['posts', 'feed'] },
}));
jest.mock('../../services/supabase.native', () => ({ supabase: {} }));

import HomeFeedScreen from '../../app/(tabs)/index';
import { HOME_HEADER_BRAND } from '../../lib/screens/home';
import { color } from '../../theme/tokens';

// ─── 3. Helpers ─────────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // Async: the suggestions load in an effect after the first render.
  await act(async () => root!.render(<HomeFeedScreen />));
  return container;
}

async function rerender(): Promise<void> {
  await act(async () => root!.render(<HomeFeedScreen />));
}

beforeEach(() => {
  state.following = [];
  state.followingSet = new Set();
  state.notifications = 0;
  state.messages = 0;
  state.suggestions = [];
  state.feed.data = { pages: [[{ id: 'post-1' }, { id: 'post-2' }]] };
  state.newest = null;
  state.feed.isPending = false;
  state.feed.isError = false;
  state.feed.refetch.mockClear();
  state.filteredFeed = { data: { pages: [[]] }, isPending: false };
  mockFeedInterests.length = 0;
  state.reel.isPending = false;
  mockPush.mockClear();
  mockNavigate.mockClear();
  mockFollowToggle.mockClear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const button = (el: HTMLElement, label: string) =>
  el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;

const precedes = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

const rgb = (hex: string) => {
  const probe = document.createElement('div');
  probe.style.color = hex;
  return probe.style.color;
};

// ─── New posts ──────────────────────────────────────────────────────────

describe('Home — New posts', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 28, 10, minutes)).toISOString();

  it('offers newer posts over the feed, and loads them from the top', async () => {
    state.feed.data = { pages: [[{ id: 'post-1', timestamp: at(0) } as never, { id: 'post-2', timestamp: at(-5) } as never]] };
    state.newest = { id: 'post-9', createdAt: at(3) };
    state.feed.refetch.mockClear();
    const el = await mount();
    const pill = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'New posts')!;
    expect(pill).toBeDefined();
    await act(async () => pill.click());
    expect(state.feed.refetch).toHaveBeenCalled();
  });

  it('offers nothing while the top of the feed is its newest post', async () => {
    state.feed.data = { pages: [[{ id: 'post-1', timestamp: at(0) } as never]] };
    state.newest = { id: 'post-1', createdAt: at(0) };
    const el = await mount();
    expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent === 'New posts')).toBe(false);
  });
});

// ─── 4. The loaded feed ─────────────────────────────────────────────────

describe('Home — with posts', () => {
  it('shows the wordmark left and bell and messages right, on white', async () => {
    const el = await mount();
    const wordmark = Array.from(el.querySelectorAll('span')).find(s => s.textContent === HOME_HEADER_BRAND)!;
    expect(wordmark).toBeDefined();
    const bell = button(el, 'Notifications')!;
    const messages = button(el, 'Messages')!;
    expect(precedes(wordmark, bell)).toBe(true);
    expect(precedes(bell, messages)).toBe(true);
    const bar = wordmark.parentElement as HTMLElement;
    expect(bar.style.backgroundColor).toBe(rgb(color.bg));
  });

  it('puts the posts after the OneSnap strip', async () => {
    const el = await mount();
    const yourOneSnap = button(el, 'Add a OneSnap')!;
    const firstPost = el.querySelector('article[data-post="post-1"]')!;
    expect(yourOneSnap).not.toBeNull();
    expect(precedes(yourOneSnap, firstPost)).toBe(true);
    expect(el.querySelectorAll('article')).toHaveLength(2);
  });

  it('tints pull-to-refresh textMuted', async () => {
    const el = await mount();
    expect(el.querySelector('[data-refresh-tint]')?.getAttribute('data-refresh-tint')).toBe(color.textMuted);
  });

  it('routes the header actions', async () => {
    const el = await mount();
    act(() => button(el, 'Notifications')!.click());
    act(() => button(el, 'Messages')!.click());
    expect(mockPush.mock.calls).toEqual([['/notifications'], ['/messages']]);
  });
});

// ─── 5. Badges ──────────────────────────────────────────────────────────

describe('Home — header badges', () => {
  it('gives each icon its own count, overflowing to 99+', async () => {
    state.notifications = 3;
    state.messages = 120;
    const el = await mount();
    const bell = button(el, 'Notifications, 3 unread')!;
    const messages = button(el, 'Messages, 120 unread')!;
    expect(bell.textContent).toBe('3');
    expect(messages.textContent).toBe('99+');
  });

  it('draws no badge at zero', async () => {
    const el = await mount();
    expect(button(el, 'Notifications')!.textContent).toBe('');
  });
});

// ─── 6. Loading ─────────────────────────────────────────────────────────

describe('Home — first load', () => {
  it('shows skeletons under a skeleton strip, not a centred spinner', async () => {
    state.feed.isPending = true;
    state.feed.data = undefined;
    const el = await mount();
    expect(el.querySelector('[data-spinner]')).toBeNull();
    // Two post skeletons (each a 4:5 media block among its bars) and the
    // strip's card placeholders.
    expect(el.querySelectorAll('div[data-animated="true"]').length).toBeGreaterThan(10);
    expect(el.querySelector('article')).toBeNull();
  });
});

// ─── 7. Error ───────────────────────────────────────────────────────────

describe('Home — the feed fails', () => {
  it('shows "Couldn\'t load your feed" with Retry, and Retry refetches', async () => {
    state.feed.isError = true;
    state.feed.data = undefined;
    const el = await mount();
    expect(el.textContent).toContain("Couldn't load your feed");
    const retry = Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Retry')!;
    act(() => retry.click());
    expect(state.feed.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps a cached feed on screen when only a refetch failed', async () => {
    state.feed.isError = true;
    const el = await mount();
    expect(el.textContent).not.toContain("Couldn't load your feed");
    expect(el.querySelectorAll('article')).toHaveLength(2);
  });
});

// ─── 8. Empty ───────────────────────────────────────────────────────────

describe('Home — empty', () => {
  it('welcomes someone who follows nobody, with Follow cards that flip in place', async () => {
    state.feed.data = { pages: [[]] };
    state.suggestions = [{ suggested_user_id: 'u-ana', username: 'ana', avatar_url: null }];
    const el = await mount();

    expect(el.textContent).toContain('Your feed starts with who you follow');
    expect(el.textContent).toContain('Suggested for you');
    expect(el.textContent).toContain('@ana');

    const follow = Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Follow')!;
    act(() => follow.click());
    expect(mockFollowToggle).toHaveBeenCalledWith({ userId: 'u-ana', username: 'ana', isPrivate: false });
    // Following did not navigate anywhere…
    expect(mockPush).not.toHaveBeenCalled();

    // …and once the follow state reflects it, the button reads Following.
    state.followingSet = new Set(['ana']);
    await rerender();
    expect(Array.from(el.querySelectorAll('button')).some(b => b.textContent === 'Following')).toBe(true);
  });

  it('offers Explore when the people you follow have not posted', async () => {
    state.feed.data = { pages: [[]] };
    state.following = ['ben'];
    const el = await mount();
    expect(el.textContent).toContain('Nothing new yet');
    const explore = Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Explore')!;
    act(() => explore.click());
    expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/search');
  });
});

// ─── The interest filter (ONE-49) ───────────────────────────────────────

describe('Home — interest filter', () => {
  const chip = (el: HTMLElement, label: string) => button(el, `Interest: ${label}`) ?? button(el, `Interest: ${label}, selected`);

  it('offers All and each interest above the feed, starting at All', async () => {
    const el = await mount();
    expect(chip(el, 'All')!.getAttribute('aria-label')).toBe('Interest: All, selected');
    expect(chip(el, 'Custom Homes')).not.toBeNull();
    expect(mockFeedInterests.every(i => i === null)).toBe(true);
  });

  it('asks the server for that interest when one is chosen', async () => {
    const el = await mount();
    act(() => chip(el, 'Custom Homes')!.click());
    expect(mockFeedInterests[mockFeedInterests.length - 1]).toBe('custom-homes');
  });

  it('explains an empty interest and offers a way back to All', async () => {
    const el = await mount();
    act(() => chip(el, 'Custom Homes')!.click());
    expect(el.textContent).toContain('Nothing in Custom Homes yet');
    act(() => (Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Show all') as HTMLButtonElement).click());
    expect(mockFeedInterests[mockFeedInterests.length - 1]).toBeNull();
    expect(chip(el, 'All')!.getAttribute('aria-label')).toBe('Interest: All, selected');
  });

  it('shows the filtered posts when there are some', async () => {
    state.filteredFeed = { data: { pages: [[{ id: 'post-9' }]] }, isPending: false };
    const el = await mount();
    act(() => chip(el, 'Custom Homes')!.click());
    expect(el.textContent).not.toContain('Nothing in Custom Homes yet');
  });

  it('starts at All on every mount: the choice is never stored', async () => {
    const first = await mount();
    act(() => chip(first, 'Custom Homes')!.click());
    act(() => root!.unmount());
    root = null;
    mockFeedInterests.length = 0;
    const second = await mount();
    expect(chip(second, 'All')!.getAttribute('aria-label')).toBe('Interest: All, selected');
    expect(mockFeedInterests.every(i => i === null)).toBe(true);
  });
});
