/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/ProfileScreens.render.test.tsx
//
// The re-skinned profile surfaces (ONE-68), mounted: your own profile, someone
// else's (following or not, private, blocked, and its ⋯ sheet), a follower
// list, and edit profile — with the type-aware tabs (ONE-43). Every data hook
// is a mock whose return value each test sets, and each tab's hook records
// that it was asked, which is how a test sees which tabs fetched.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

const mockOpenURL = jest.fn((_url: string) => Promise.resolve());

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  const box = (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children);
  const slot = (C: unknown) =>
    C == null ? null : React.isValidElement(C) ? C : React.createElement(C as React.FC);
  const FlatList = (props: {
    data: unknown[];
    renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    keyExtractor: (item: unknown) => string;
    ListHeaderComponent?: unknown;
    ListEmptyComponent?: unknown;
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
    );
  return {
    ...shim,
    FlatList,
    ScrollView: box,
    KeyboardAvoidingView: box,
    RefreshControl: () => null,
    Platform: { OS: 'ios' },
    useWindowDimensions: () => ({ width: 375, height: 812 }),
    Linking: { openURL: mockOpenURL },
  };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('expo-image', () => require('../support/expoImageStub'));
jest.mock('expo-image-picker', () => require('../support/expoImagePickerStub'));
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
/** Whether there is a screen under this one: false for a cold-start link (ONE-90). */
const mockStack = { canGoBack: true };
const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace, canGoBack: () => mockStack.canGoBack }),
    useLocalSearchParams: () => mockParams.current,
    // The header's slots are rendered inline, so its buttons are reachable.
    Stack: {
      Screen: (p: { options?: { headerLeft?: () => unknown; headerRight?: () => unknown } }) =>
        React.createElement(React.Fragment, null, p.options?.headerLeft?.() ?? null, p.options?.headerRight?.() ?? null),
    },
  };
});

// ─── 2. Mock the data layer ─────────────────────────────────────────────

const ME = { id: 'p-me', username: 'me', name: 'Me Myself', bio: 'Builds things.', profilePicture: null, isVerified: true };

/** A business profile, with every business field filled in (ONE-23). */
const ME_BUSINESS = {
  ...ME,
  profileType: 'business',
  business: { category: 'Cafe', website: 'https://me.example/', location: 'Austin, TX', logoUrl: null },
};

const state = {
  me: ME as Record<string, unknown>,
  blocked: new Set<string>(),
  following: new Set<string>(),
  counts: { followers: 10, following: 4 },
  isAdmin: false,
  profile: null as null | Record<string, unknown>,
  posts: [] as unknown[],
  /** Profiles whose posts are still loading, to test what shows meanwhile. */
  postsPending: new Set<string>(),
  postCount: 1,
  users: [] as unknown[],
  /** Their scan history, as scan_history would return it (ONE-35). */
  scans: [] as unknown[],
  products: [] as unknown[],
  owned: [] as unknown[],
  contributed: [] as unknown[],
  saved: [] as unknown[],
};

/** Which tab queries were asked for, and for whom — each only once its tab is open. */
const mockAsked = jest.fn();
const mockRefetch = jest.fn(() => Promise.resolve());
/** A settled query's shape, as the tab list reads it. */
const mockQuery = (data: unknown) => ({ data, isPending: false, isError: false, refetch: mockRefetch });

const mockApp = {
  addToast: jest.fn(),
  isUserBlocked: (u: string) => state.blocked.has(u),
  toggleBlockUser: jest.fn(),
  triggerHapticFeedback: jest.fn(),
};
jest.mock('../../store/AppContext.native', () => ({ useApp: () => mockApp }));

const mockFollowToggle = jest.fn();
const mockUpdateProfile = jest.fn(() => Promise.resolve());
const mockUpdateBusiness = jest.fn((_updates: unknown) => Promise.resolve());
const mockSetActive = jest.fn();
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({ profile: state.me, profileId: state.me.id, authUserId: 'a-me' }),
  useMyProfilesQuery: () => ({ data: [state.me] }),
  useSetActiveProfile: () => ({ mutate: mockSetActive }),
  asProfileId: (id: string) => id,
  useFollowCountsQuery: () => ({ data: state.counts }),
  useFollowState: () => ({ isFollowing: (u: string) => state.following.has(u) }),
  useToggleFollow: () => ({ toggle: mockFollowToggle, isPending: false }),
  profileKeys: { all: ['profiles'], posts: () => ['p'], counts: () => ['c'], postCount: () => ['pc'] },
  useProfilePostCountQuery: () => ({ data: state.postCount }),
  useProfilePostsQuery: (id: string) => {
    mockAsked('posts', id);
    return state.postsPending.has(id)
      ? { data: undefined, isPending: true, isError: false, refetch: mockRefetch }
      : mockQuery(state.posts);
  },
  getUserProfile: () => Promise.resolve(state.profile),
  getFollowerUsers: () => Promise.resolve(state.users),
  getFollowingUsers: () => Promise.resolve(state.users),
  useUpdateProfile: () => ({ mutateAsync: mockUpdateProfile }),
  useUpdateBusinessProfile: () => ({ mutateAsync: mockUpdateBusiness }),
  useUploadAvatar: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock('../../lib/realtimeBridge', () => ({ useRealtimeSync: jest.fn() }));
const mockScanHistoryAsked = jest.fn();
jest.mock('../../features/scans', () => ({
  // Answers only when asked for a public history, as the screen should ask.
  useProfileScanHistoryQuery: (profileId: string, isPublic: boolean) => {
    if (isPublic) mockScanHistoryAsked(profileId);
    return isPublic ? mockQuery(state.scans) : { data: undefined, isPending: true, isError: false, refetch: mockRefetch };
  },
  useMyScanHistoryQuery: (profileId: string | undefined) => {
    if (profileId) mockAsked('my-scans', profileId);
    return profileId ? mockQuery(state.scans) : { data: undefined, isPending: true, isError: false, refetch: mockRefetch };
  },
}));
jest.mock('../../features/saves', () => ({
  useSavedItemsQuery: (profileId: string) => {
    mockAsked('saves', profileId);
    return mockQuery(state.saved);
  },
}));
jest.mock('../../features/products', () => ({
  useBusinessProductsQuery: (profileId: string) => {
    mockAsked('products', profileId);
    return mockQuery(state.products);
  },
}));
jest.mock('../../features/projects', () => ({
  useOwnedProjectsQuery: (profileId: string) => {
    mockAsked('owned-projects', profileId);
    return mockQuery(state.owned);
  },
  useContributedProjectsQuery: (profileId: string) => {
    mockAsked('contributed-projects', profileId);
    return mockQuery(state.contributed);
  },
}));
jest.mock('../../features/posts', () => ({
  getPostLikers: () => Promise.resolve([]),
  getPostReposters: () => Promise.resolve([]),
}));
jest.mock('../../features/admin', () => ({ setUserVerified: jest.fn(), useIsAdmin: () => state.isAdmin }));
jest.mock('../../features/auth', () => ({ useAuthUserId: () => 'a-me', useAuthStatus: () => 'signed-in' }));
jest.mock('../../features/moderation', () => ({ reportUser: jest.fn(() => Promise.resolve(true)) }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(() => Promise.resolve()) }),
}));

import OwnProfileScreen from '../../app/(tabs)/profile';
import UserProfileScreen from '../../app/user/[username]';
import UserListScreen from '../../app/user-list';
import EditProfileScreen from '../../app/edit-profile';
import { REPORT_REASONS } from '../../services/reportReasons';

// ─── 3. Helpers ─────────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

async function rerender(element: React.ReactElement): Promise<void> {
  await act(async () => root!.render(element));
}

beforeEach(() => {
  state.me = ME;
  state.blocked = new Set();
  state.following = new Set();
  state.counts = { followers: 10, following: 4 };
  state.isAdmin = false;
  state.profile = { id: 'p-ana', username: 'ana', name: 'Ana Reyes', bio: 'Hi.', profilePicture: null, isVerified: false, isPrivate: false };
  state.posts = [{ id: 'post-1', content: 'first line\nsecond', media_type: 'text' }];
  state.users = [];
  state.scans = [];
  mockScanHistoryAsked.mockClear();
  state.postsPending = new Set();
  state.postCount = 1;
  state.products = [];
  state.owned = [];
  state.contributed = [];
  state.saved = [];
  mockAsked.mockClear();
  mockParams.current = {};
  [mockPush, mockBack, mockReplace, mockFollowToggle, mockUpdateProfile, mockUpdateBusiness, mockOpenURL, mockSetActive].forEach(m => m.mockClear());
  mockStack.canGoBack = true;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const button = (el: HTMLElement, label: string) =>
  el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;

const buttonByText = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find(b => b.textContent === text) as HTMLButtonElement | undefined;

/** The tab strip's tabs, in order, by name. */
const tabNames = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('button[aria-label]'))
    .filter((b) => ['Posts', 'Media', 'Products', 'Projects', 'Saves', 'Scans'].includes(b.getAttribute('aria-label') ?? ''))
    .map((b) => b.getAttribute('aria-label'));

const selectTab = async (el: HTMLElement, name: string) => {
  await act(async () => button(el, name)!.click());
};

// ─── 4. Your own profile ────────────────────────────────────────────────

describe('Your profile', () => {
  it('shows avatar, stats, name, handle, bio and Edit profile, with an individual profile\'s tabs', async () => {
    const el = await mount(<OwnProfileScreen />);
    const text = el.textContent ?? '';
    expect(text).toContain('Me Myself');
    expect(text).toContain('@me');
    expect(text).toContain('Builds things.');
    expect(el.querySelector('[aria-label="1 Posts"]')).not.toBeNull();
    expect(button(el, '10 Followers')).not.toBeNull();
    expect(button(el, '4 Following')).not.toBeNull();
    expect(buttonByText(el, 'Edit Profile')).toBeDefined();
    expect(el.querySelector('[aria-label="Verified"]')).not.toBeNull();
    expect(tabNames(el)).toEqual(['Posts', 'Saves', 'Projects', 'Scans']);
  });

  it('opens the edit screen itself from Edit Profile, not Settings', async () => {
    const el = await mount(<OwnProfileScreen />);
    act(() => buttonByText(el, 'Edit Profile')!.click());
    expect(mockPush).toHaveBeenCalledWith('/edit-profile');
  });

  it('draws a text post as its first line in the grid', async () => {
    const el = await mount(<OwnProfileScreen />);
    expect(button(el, 'first line')).not.toBeNull();
  });

  it('opens the followers list from the stat', async () => {
    const el = await mount(<OwnProfileScreen />);
    act(() => button(el, '10 Followers')!.click());
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/user-list', params: expect.objectContaining({ type: 'followers' }) }));
  });

  it('shows the profile you are acting as in the top bar, and opens the switcher from it (ONE-25)', async () => {
    const el = await mount(<OwnProfileScreen />);
    const entry = button(el, 'Acting as @me. Switch profile')!;
    expect(entry.textContent).toContain('@me');
    expect(el.querySelector('[data-modal]')).toBeNull();

    act(() => entry.click());
    expect(el.querySelector('[data-modal]')).not.toBeNull();
    expect(button(el, 'Me Myself, @me, Individual profile, active')).not.toBeNull();

    act(() => button(el, 'Add a Profile')!.click());
    expect(mockPush).toHaveBeenCalledWith('/create-profile');
  });

  it("drops the previous profile's grid the moment the acting profile switches", async () => {
    const el = await mount(<OwnProfileScreen />);
    expect(button(el, 'first line')).not.toBeNull();

    // A switch to the business profile, whose posts have not arrived yet.
    state.postsPending = new Set(['p-biz']);
    state.me = { ...ME_BUSINESS, id: 'p-biz', username: 'me_studio' };
    await rerender(<OwnProfileScreen />);

    expect(button(el, 'first line')).toBeNull();
    expect(el.textContent).toContain('@me_studio');
    // A business opens on its Products, and its posts are its Media.
    expect(tabNames(el)).toEqual(['Products', 'Projects', 'Media']);
    await selectTab(el, 'Media');
    expect(button(el, 'first line')).toBeNull();

    state.postsPending = new Set();
    state.posts = [{ id: 'post-b', content: 'studio news', media_type: 'text' }];
    await rerender(<OwnProfileScreen />);
    expect(button(el, 'studio news')).not.toBeNull();
  });

  it('opens the Tags dashboard from the top bar (ONE-34)', async () => {
    const el = await mount(<OwnProfileScreen />);
    act(() => button(el, 'Tags')!.click());
    expect(mockPush).toHaveBeenCalledWith('/tags');
  });

  it('offers Create tag on a business profile, and not on an individual one (ONE-32)', async () => {
    const individual = await mount(<OwnProfileScreen />);
    expect(buttonByText(individual, 'Create tag')).toBeUndefined();

    state.me = ME_BUSINESS;
    await rerender(<OwnProfileScreen />);
    act(() => buttonByText(individual, 'Create tag')!.click());
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/tags/create', params: {} });
  });

  it('offers a business profile Add a product, from Create in the top bar (ONE-40)', async () => {
    state.me = ME_BUSINESS;
    const el = await mount(<OwnProfileScreen />);
    act(() => button(el, 'Create')!.click());
    act(() => button(el, 'Add a product')!.click());
    expect(mockPush).toHaveBeenCalledWith('/product/create');
  });

  it('offers an individual profile a new project, and no way to create a product (ONE-40, ONE-41)', async () => {
    const el = await mount(<OwnProfileScreen />);
    act(() => button(el, 'Create')!.click());
    expect(button(el, 'Add a product')).toBeNull();
    expect(el.textContent).not.toMatch(/add a product/i);
    act(() => button(el, 'New project')!.click());
    expect(mockPush).toHaveBeenCalledWith('/project/create');
  });

  it('offers a business profile a new project too (ONE-41)', async () => {
    state.me = ME_BUSINESS;
    const el = await mount(<OwnProfileScreen />);
    act(() => button(el, 'Create')!.click());
    act(() => button(el, 'New project')!.click());
    expect(mockPush).toHaveBeenCalledWith('/project/create');
  });

  it('invites your first post when you have none', async () => {
    state.posts = [];
    const el = await mount(<OwnProfileScreen />);
    expect(el.textContent).toContain('No posts yet');
    act(() => buttonByText(el, 'Create your first post')!.click());
    expect(mockPush).toHaveBeenCalledWith('/compose');
  });
});

// ─── 4b. Business fields (ONE-23) ───────────────────────────────────────

describe('Business fields on a profile', () => {
  const location = (el: HTMLElement) => el.querySelector('[aria-label^="Location"]');
  const website = (el: HTMLElement) => el.querySelector('[aria-label^="Website"]') as HTMLElement | null;

  it('shows an individual profile exactly as before: no category, location or website', async () => {
    const el = await mount(<OwnProfileScreen />);
    expect(location(el)).toBeNull();
    expect(website(el)).toBeNull();
    expect(el.textContent).not.toContain('Cafe');
  });

  it("shows a business profile's category, location and website, and opens the website", async () => {
    state.me = ME_BUSINESS;
    const el = await mount(<OwnProfileScreen />);
    expect(el.textContent).toContain('Cafe');
    expect(location(el)!.textContent).toBe('Austin, TX');

    expect(website(el)!.getAttribute('aria-label')).toBe('Website, me.example');
    act(() => website(el)!.click());
    expect(mockOpenURL).toHaveBeenCalledWith('https://me.example/');
  });

  it('decides by type: an individual profile carrying business data shows none of it', async () => {
    state.me = { ...ME_BUSINESS, profileType: 'individual' };
    const el = await mount(<OwnProfileScreen />);
    expect(el.textContent).not.toContain('Cafe');
    expect(website(el)).toBeNull();
  });

  it("shows another account's business fields, from the one profile request", async () => {
    mockParams.current = { username: 'ana' };
    state.profile = {
      ...state.profile!,
      profileType: 'business',
      business: { category: 'Bakery', website: 'https://ana.example', location: 'Lisbon', logoUrl: null },
    };
    const el = await mount(<UserProfileScreen />);
    expect(el.textContent).toContain('Bakery');
    expect(location(el)!.textContent).toBe('Lisbon');
    expect(website(el)!.getAttribute('aria-label')).toBe('Website, ana.example');
  });
});

// ─── 5. Someone else's profile ──────────────────────────────────────────

describe('Another profile', () => {
  beforeEach(() => { mockParams.current = { username: 'ana' }; });

  it('offers Follow and Message; once followed, Following, with the count moved by one', async () => {
    const el = await mount(<UserProfileScreen />);
    expect(buttonByText(el, 'Follow')).toBeDefined();
    expect(buttonByText(el, 'Message')).toBeDefined();
    expect(tabNames(el)).not.toContain('Saves');

    act(() => buttonByText(el, 'Follow')!.click());
    expect(mockFollowToggle).toHaveBeenCalledWith({ userId: 'p-ana', username: 'ana' });

    // The optimistic toggle moves follow state and the count together.
    state.following = new Set(['ana']);
    state.counts = { followers: 11, following: 4 };
    await rerender(<UserProfileScreen />);
    expect(buttonByText(el, 'Following')).toBeDefined();
    expect(button(el, '11 Followers')).not.toBeNull();
  });

  it('has no Scans tab at all when their scan history is private, and asks for none (ONE-35, ONE-43)', async () => {
    state.scans = [{ key: 'profile:p-x', kind: 'profile', destinationId: 'p-x', name: 'Xavi', username: 'xavi', scanCount: 2, lastScannedAt: new Date().toISOString() }];
    const el = await mount(<UserProfileScreen />);
    expect(tabNames(el)).toEqual(['Posts', 'Projects']);
    expect(el.textContent).not.toMatch(/scan/i);
    expect(mockScanHistoryAsked).not.toHaveBeenCalled();
  });

  it('has a Scans tab when their history is public, each row routing to its destination', async () => {
    state.profile = { ...state.profile!, scanHistoryPublic: true };
    state.scans = [
      { key: 'profile:p-x', kind: 'profile', destinationId: 'p-x', name: 'Xavi', username: 'xavi', scanCount: 10, lastScannedAt: new Date().toISOString() },
      { key: 'product:pd-1', kind: 'product', destinationId: 'pd-1', name: 'Oak door', username: null, scanCount: 1, lastScannedAt: new Date().toISOString() },
    ];
    const el = await mount(<UserProfileScreen />);
    expect(tabNames(el)).toEqual(['Posts', 'Projects', 'Scans']);
    // Lazy: nothing is asked for until the tab is opened.
    expect(mockScanHistoryAsked).not.toHaveBeenCalled();

    await selectTab(el, 'Scans');
    expect(mockScanHistoryAsked).toHaveBeenCalledWith('p-ana');
    expect(el.textContent).toContain('Profile · Scanned 10 times');
    // A visitor gets no settings notice: that is the owner's.
    expect(el.textContent).not.toContain('Change in Settings');

    const row = (prefix: string) => el.querySelector(`button[aria-label^="${prefix}"]`) as HTMLButtonElement;
    act(() => row('Xavi, Profile, Scanned 10 times').click());
    expect(mockPush).toHaveBeenCalledWith('/user/xavi');
    act(() => row('Oak door, Product, Scanned once').click());
    expect(mockPush).toHaveBeenCalledWith('/product/pd-1');
  });

  it('shows the header and a locked state in place of the grid when private', async () => {
    state.profile = { ...state.profile!, isPrivate: true };
    const el = await mount(<UserProfileScreen />);
    expect(el.textContent).toContain('Ana Reyes');
    expect(el.textContent).toContain('This account is private');
    expect(el.querySelector('[role="tab"]')).toBeNull();
    expect(button(el, 'first line')).toBeNull();
  });

  it('shows a blocked state, with Unblock, when you blocked them', async () => {
    state.blocked = new Set(['ana']);
    const el = await mount(<UserProfileScreen />);
    expect(el.textContent).toContain('You blocked @ana');
    expect(buttonByText(el, 'Unblock')).toBeDefined();
    expect(buttonByText(el, 'Follow')).toBeUndefined();
  });

  it('puts Report, Block and (for admins) Verify in the ⋯ sheet', async () => {
    state.isAdmin = true;
    const el = await mount(<UserProfileScreen />);
    act(() => button(el, 'Profile options')!.click());
    expect(button(el, 'Report User')).not.toBeNull();
    expect(button(el, 'Block')).not.toBeNull();
    expect(button(el, 'Verify Account')).not.toBeNull();

    act(() => button(el, 'Report User')!.click());
    for (const reason of REPORT_REASONS) expect(button(el, reason)).not.toBeNull();
  });

  it('leaves Back to the native header when there is a screen to go back to (ONE-90)', async () => {
    const el = await mount(<UserProfileScreen />);
    expect(button(el, 'Back')).toBeNull();
  });

  it('goes home from Back when a tag opened it alone on the stack (ONE-90)', async () => {
    mockStack.canGoBack = false;
    const el = await mount(<UserProfileScreen />);
    act(() => button(el, 'Back')!.click());
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  });

  it('keeps Verify out of the sheet for everyone else', async () => {
    const el = await mount(<UserProfileScreen />);
    act(() => button(el, 'Profile options')!.click());
    expect(button(el, 'Verify Account')).toBeNull();
  });
});

// ─── 5b. Type-aware tabs (ONE-43) ───────────────────────────────────────

describe('Type-aware tabs (ONE-43)', () => {
  const PRODUCT = { id: 'pd-1', businessProfileId: 'p-me', name: 'Oak door', category: 'Doors', priceCents: null, currency: 'USD', available: true, imageUrl: null };
  const PROJECT = { id: 'pj-1', ownerProfileId: 'p-me', name: 'Barn conversion', projectType: 'Renovation', year: '2025', coverUrl: null, isPublic: true, createdAt: '2026-01-01T00:00:00Z' };
  const asked = () => mockAsked.mock.calls.map(([what]) => what);

  it('gives a business Products, Projects and Media, and Projects an Owned/Contributed toggle', async () => {
    state.me = ME_BUSINESS;
    const el = await mount(<OwnProfileScreen />);
    expect(tabNames(el)).toEqual(['Products', 'Projects', 'Media']);
    await selectTab(el, 'Projects');
    expect(button(el, 'Projects: Owned, selected')).not.toBeNull();
    expect(button(el, 'Projects: Contributed')).not.toBeNull();
  });

  it('gives a business the same three tabs when someone else looks', async () => {
    mockParams.current = { username: 'ana' };
    state.profile = { ...state.profile!, profileType: 'business', scanHistoryPublic: true };
    const el = await mount(<UserProfileScreen />);
    expect(tabNames(el)).toEqual(['Products', 'Projects', 'Media']);
  });

  it('fetches only the tab that opens first', async () => {
    state.me = ME_BUSINESS;
    await mount(<OwnProfileScreen />);
    expect(asked()).toEqual(expect.arrayContaining(['products']));
    expect(asked()).not.toEqual(expect.arrayContaining(['posts']));
    expect(new Set(asked())).toEqual(new Set(['products']));

    act(() => root!.unmount());
    root = null;
    mockAsked.mockClear();
    state.me = ME;
    await mount(<OwnProfileScreen />);
    expect(new Set(asked())).toEqual(new Set(['posts']));
  });

  it('asks for a tab\'s content once that tab is selected', async () => {
    const el = await mount(<OwnProfileScreen />);
    expect(asked()).not.toContain('saves');
    await selectTab(el, 'Saves');
    expect(asked()).toContain('saves');
    expect(asked()).not.toContain('my-scans');
    await selectTab(el, 'Scans');
    expect(asked()).toContain('my-scans');
  });

  it('prompts a business owner to add a first product, and tells a visitor there are none', async () => {
    state.me = ME_BUSINESS;
    const own = await mount(<OwnProfileScreen />);
    expect(own.textContent).toContain('No products yet');
    act(() => buttonByText(own, 'Add your first product')!.click());
    expect(mockPush).toHaveBeenCalledWith('/product/create');

    act(() => root!.unmount());
    root = null;
    mockParams.current = { username: 'ana' };
    state.profile = { ...state.profile!, profileType: 'business' };
    const visitor = await mount(<UserProfileScreen />);
    expect(visitor.textContent).toContain('This business has not listed any products.');
    expect(buttonByText(visitor, 'Add your first product')).toBeUndefined();
  });

  it('prompts you to start a project, and says nothing can be done about an empty contributed list', async () => {
    const el = await mount(<OwnProfileScreen />);
    await selectTab(el, 'Projects');
    act(() => buttonByText(el, 'Start a project')!.click());
    expect(mockPush).toHaveBeenCalledWith('/project/create');
    await act(async () => button(el, 'Projects: Contributed')!.click());
    expect(el.textContent).toContain('When someone adds you as a contributor');
    expect(buttonByText(el, 'Start a project')).toBeUndefined();
  });

  it('routes every product and project onward', async () => {
    state.me = ME_BUSINESS;
    state.products = [PRODUCT];
    state.owned = [PROJECT];
    state.contributed = [{ ...PROJECT, id: 'pj-2', name: 'City loft', ownerProfileId: 'p-other' }];
    const el = await mount(<OwnProfileScreen />);

    act(() => button(el, 'Oak door')!.click());
    expect(mockPush).toHaveBeenCalledWith('/product/pd-1');

    await selectTab(el, 'Projects');
    act(() => (el.querySelector('button[aria-label^="Barn conversion"]') as HTMLElement).click());
    expect(mockPush).toHaveBeenCalledWith('/project/pj-1');

    await act(async () => button(el, 'Projects: Contributed')!.click());
    act(() => (el.querySelector('button[aria-label^="City loft"]') as HTMLElement).click());
    expect(mockPush).toHaveBeenCalledWith('/project/pj-2');
  });

  it('marks a private project, which only those who may see it are shown', async () => {
    state.owned = [{ ...PROJECT, isPublic: false }];
    const el = await mount(<OwnProfileScreen />);
    await selectTab(el, 'Projects');
    expect(button(el, 'Barn conversion, Private · Renovation · 2025')).not.toBeNull();
  });

  it('mixes all four kinds of save, filters them by kind, and routes each to its target', async () => {
    state.saved = [
      { saveId: 's1', savedAt: '2026-09-04T00:00:00Z', kind: 'post', post: { id: 'post-9', username: 'ana', content: 'A new kitchen', media_type: 'text' } },
      { saveId: 's2', savedAt: '2026-09-03T00:00:00Z', kind: 'product', product: PRODUCT },
      { saveId: 's3', savedAt: '2026-09-02T00:00:00Z', kind: 'project', project: PROJECT },
      { saveId: 's4', savedAt: '2026-09-01T00:00:00Z', kind: 'profile', profile: { id: 'p-ana', username: 'ana', name: 'Ana Reyes', avatarUrl: null, isVerified: false, profileType: 'individual' } },
    ];
    const el = await mount(<OwnProfileScreen />);
    await selectTab(el, 'Saves');

    const rows = () => Array.from(el.querySelectorAll('button[aria-label]')).map((b) => b.getAttribute('aria-label')!);
    expect(rows()).toEqual(expect.arrayContaining([
      'A new kitchen, Post · @ana',
      'Oak door, Product · Doors',
      'Barn conversion, Project · Renovation · 2025',
      'Ana Reyes, Profile · @ana',
    ]));

    act(() => button(el, 'A new kitchen, Post · @ana')!.click());
    expect(mockPush).toHaveBeenCalledWith('/post/post-9');
    act(() => button(el, 'Oak door, Product · Doors')!.click());
    expect(mockPush).toHaveBeenCalledWith('/product/pd-1');
    act(() => button(el, 'Barn conversion, Project · Renovation · 2025')!.click());
    expect(mockPush).toHaveBeenCalledWith('/project/pj-1');
    act(() => button(el, 'Ana Reyes, Profile · @ana')!.click());
    expect(mockPush).toHaveBeenCalledWith('/user/ana');

    await act(async () => button(el, 'Show: Products')!.click());
    expect(button(el, 'Oak door, Product · Doors')).not.toBeNull();
    expect(button(el, 'A new kitchen, Post · @ana')).toBeNull();
    expect(button(el, 'Ana Reyes, Profile · @ana')).toBeNull();
  });

  it('says who can see your scans on your own Scans tab, with the way to change it', async () => {
    const el = await mount(<OwnProfileScreen />);
    await selectTab(el, 'Scans');
    act(() => button(el, 'Only you can see the tags you have scanned. Change in Settings')!.click());
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });
});

// ─── 6. Follower lists ──────────────────────────────────────────────────

describe('Follower list', () => {
  it('rows show name and handle with a Follow button, and your own row has none', async () => {
    mockParams.current = { type: 'followers', userId: 'p-ana', title: 'Followers' };
    state.users = [
      { id: 'p-ben', username: 'ben', name: 'Ben Ode', avatar: null, isVerified: false },
      { id: 'p-me', username: 'me', name: 'Me Myself', avatar: null, isVerified: false },
    ];
    const el = await mount(<UserListScreen />);
    const ben = button(el, "View ben's profile")!;
    expect(ben.textContent).toContain('Ben Ode');
    expect(ben.textContent).toContain('@ben');
    expect(ben.textContent).toContain('Follow');
    const me = button(el, "View me's profile")!;
    expect(me.textContent).not.toContain('Follow');
  });

  it('says "No followers yet" when empty', async () => {
    mockParams.current = { type: 'followers', userId: 'p-ana', title: 'Followers' };
    const el = await mount(<UserListScreen />);
    expect(el.textContent).toContain('No followers yet');
  });
});

// ─── 7. Edit profile ────────────────────────────────────────────────────

describe('Edit profile', () => {
  const field = (el: HTMLElement, label: string) => el.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;

  it('keeps Save disabled until something changes, then saves as before', async () => {
    const el = await mount(<EditProfileScreen />);
    const save = () => button(el, 'Save')!;
    expect(save().disabled).toBe(true);

    const bio = field(el, 'Bio');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(bio, 'Builds better things.');
      bio.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(save().disabled).toBe(false);
    expect(el.textContent).toContain(String('Builds better things.'.length));

    await act(async () => { save().click(); });
    expect(mockUpdateProfile).toHaveBeenCalledWith(expect.objectContaining({ bio: 'Builds better things.' }));
    expect(mockBack).toHaveBeenCalled();
  });

  it('will not save a username sign-up would refuse, and says why', async () => {
    const el = await mount(<EditProfileScreen />);
    const username = field(el, 'Username');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(username, 'me too');
      username.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(button(el, 'Save')!.disabled).toBe(true);
    expect(el.textContent).toContain('Only lowercase letters');

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(username, 'Me_Too');
      username.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Lowercased as typed, as sign-up does, which makes it valid.
    expect(username.value).toBe('me_too');
    expect(button(el, 'Save')!.disabled).toBe(false);
  });

  it('labels its fields', async () => {
    const el = await mount(<EditProfileScreen />);
    for (const label of ['Name', 'Username', 'Bio']) {
      expect(field(el, label)).not.toBeNull();
    }
    expect(el.textContent).toContain('Change photo');
  });

  const typeInto = (input: HTMLInputElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('offers no business fields on an individual profile', async () => {
    const el = await mount(<EditProfileScreen />);
    for (const label of ['Category', 'Website', 'Location']) expect(field(el, label)).toBeNull();
  });

  it("edits a business profile's fields, saving the website with its scheme", async () => {
    state.me = { ...ME_BUSINESS, business: { category: 'Cafe', website: null, location: null, logoUrl: null } };
    const el = await mount(<EditProfileScreen />);
    expect(field(el, 'Category').value).toBe('Cafe');

    typeInto(field(el, 'Website'), '  shop.example ');
    typeInto(field(el, 'Location'), 'Austin, TX');
    expect(button(el, 'Save')!.disabled).toBe(false);

    await act(async () => { button(el, 'Save')!.click(); });
    expect(mockUpdateBusiness).toHaveBeenCalledWith({ category: 'Cafe', website: 'https://shop.example', location: 'Austin, TX' });
    // Nothing on the profile row itself changed, so it is not rewritten.
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
  });

  it('will not save a website that is not a web address, and says why', async () => {
    state.me = ME_BUSINESS;
    const el = await mount(<EditProfileScreen />);
    typeInto(field(el, 'Website'), 'not a website');
    expect(button(el, 'Save')!.disabled).toBe(true);
    expect(el.textContent).toContain('Enter a web address');
  });
});
