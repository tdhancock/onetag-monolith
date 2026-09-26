/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/ProfileScreens.render.test.tsx
//
// The re-skinned profile surfaces (ONE-68), mounted: your own profile, someone
// else's (following or not, private, blocked, and its ⋯ sheet), a follower
// list, and edit profile. Every data hook is a mock whose return value each
// test sets.

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
const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams.current,
  // The header's right slot is rendered inline, so the ⋯ button is reachable.
  Stack: {
    Screen: (p: { options?: { headerRight?: () => unknown } }) => (p.options?.headerRight ? p.options.headerRight() : null),
  },
}));

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
  /** Per-profile post requests a test controls the timing of. */
  postsFor: {} as Partial<Record<string, Promise<unknown[]>>>,
  users: [] as unknown[],
};

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
  profileKeys: { all: ['profiles'], posts: () => ['p'], counts: () => ['c'] },
  getUserPosts: (id: string) => state.postsFor[id] ?? Promise.resolve(state.posts),
  getUserReposts: () => Promise.resolve([]),
  getUserProfile: () => Promise.resolve(state.profile),
  getFollowerUsers: () => Promise.resolve(state.users),
  getFollowingUsers: () => Promise.resolve(state.users),
  useUpdateProfile: () => ({ mutateAsync: mockUpdateProfile }),
  useUpdateBusinessProfile: () => ({ mutateAsync: mockUpdateBusiness }),
  useUploadAvatar: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock('../../lib/realtimeBridge', () => ({ useRealtimeSync: jest.fn() }));
jest.mock('../../features/posts', () => ({
  getSavedPosts: () => Promise.resolve([]),
  getPostLikers: () => Promise.resolve([]),
  getPostReposters: () => Promise.resolve([]),
}));
jest.mock('../../features/admin', () => ({ setUserVerified: jest.fn(), useIsAdmin: () => state.isAdmin }));
jest.mock('../../features/auth', () => ({ useAuthUserId: () => 'a-me' }));
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
  state.postsFor = {};
  mockParams.current = {};
  [mockPush, mockBack, mockFollowToggle, mockUpdateProfile, mockUpdateBusiness, mockOpenURL, mockSetActive].forEach(m => m.mockClear());
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

// ─── 4. Your own profile ────────────────────────────────────────────────

describe('Your profile', () => {
  it('shows avatar, stats, name, handle, bio and Edit profile, with tabs including Saved', async () => {
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
    for (const tab of ['Posts', 'Reposts', 'Saved']) {
      expect(el.querySelector(`button[role="tab"][aria-label="${tab}"], button[aria-label="${tab}"]`)).not.toBeNull();
    }
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

    // The business profile's posts have not arrived yet.
    let resolveBusiness: (posts: unknown[]) => void = () => undefined;
    state.postsFor['p-biz'] = new Promise((resolve) => { resolveBusiness = resolve; });
    state.me = { ...ME_BUSINESS, id: 'p-biz', username: 'me_studio' };
    await rerender(<OwnProfileScreen />);

    expect(button(el, 'first line')).toBeNull();
    expect(el.textContent).toContain('@me_studio');

    await act(async () => resolveBusiness([{ id: 'post-b', content: 'studio news', media_type: 'text' }]));
    expect(button(el, 'studio news')).not.toBeNull();
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
    expect(buttonByText(el, 'Saved')).toBeUndefined();

    act(() => buttonByText(el, 'Follow')!.click());
    expect(mockFollowToggle).toHaveBeenCalledWith({ userId: 'p-ana', username: 'ana' });

    // The optimistic toggle moves follow state and the count together.
    state.following = new Set(['ana']);
    state.counts = { followers: 11, following: 4 };
    await rerender(<UserProfileScreen />);
    expect(buttonByText(el, 'Following')).toBeDefined();
    expect(button(el, '11 Followers')).not.toBeNull();
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

  it('keeps Verify out of the sheet for everyone else', async () => {
    const el = await mount(<UserProfileScreen />);
    act(() => button(el, 'Profile options')!.click());
    expect(button(el, 'Verify Account')).toBeNull();
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
