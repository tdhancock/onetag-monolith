/**
 * @jest-environment jsdom
 *

 *
 * target: __tests__/useAppContext.test.tsx
 *
 * Tests for the `useApp` hook (exported from `store/AppContext.native.tsx`).
 *
 * Repointed from the deleted web fork's `store/AppContext.tsx` to the live
 * native provider. The public surface is identical — `AppProvider` plus
 * `useApp`, which throws the same "must be used within an AppProvider"
 * error — but the persistence layer is not: the fork hydrated its
 * block-list synchronously from `localStorage` inside the useState
 * initializer, while the native provider reads AsyncStorage in an effect
 * after mount. The hydration test below follows the native behaviour.
 *
 * NOTE on naming: the hook is `useApp`, not `useAppContext`; the context
 * object itself is module-private. These tests cover the public hook,
 * which is what the rest of the codebase imports.
 *
 * Strategy:
 *   - We use `react-dom/client` (createRoot) and React's own `act`
 *     instead of `react-test-renderer`, which is deprecated in React 19.
 *     jsdom supplies the DOM; we mount into a transient container element.
 *   - The auth transitions (sign-in, sign-out, token refresh) are driven
 *     through the listener the provider registers, so they test the real
 *     provider rather than a hand-written copy of its state.
 *   - The provider's network-bound effects (Supabase auth listener,
 *     notification/message subscriptions) are stubbed via `jest.mock`
 *     so the test stays synchronous and offline.
 *   - The hook + provider tree is exercised by a tiny "Probe" component
 *     that calls the hook and writes the returned value to a ref the
 *     test can inspect.
 */

// ─── 1. Mock the Supabase service layer ─────────────────────────────────
// The AppProvider immediately calls `supabase.auth.onAuthStateChange` in
// a useEffect. We mock the methods to return safe, no-op shapes so the
// provider mounts cleanly.

// Tell React that we're in an act-capable environment so the
// "current testing environment is not configured to support act(...)"
// warning stops polluting the test output.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockOnAuthStateChange = jest.fn(() => ({
  data: { subscription: { unsubscribe: jest.fn() } },
}));

const mockAuthGetUser = jest.fn(async () => ({
  data: { user: null },
  error: null,
}));

// The auth user id the provider hands to useCurrentUserQuery, last render.
let mockCurrentUserArg: string | undefined;

// The native provider persists the block-list to AsyncStorage and reads it
// back in a post-mount effect. A mutable store lets a test seed it before
// mounting, the way a returning user's device would already have it.
let mockAsyncStore: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) =>
      Object.prototype.hasOwnProperty.call(mockAsyncStore, key)
        ? mockAsyncStore[key]
        : null,
    ),
    setItem: jest.fn(async (key: string, value: string) => {
      mockAsyncStore[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete mockAsyncStore[key];
    }),
  },
}), { virtual: true });

// Haptics fire on like/repost/save. Never invoked by these tests, but the
// import has to resolve.
jest.mock('expo-haptics', () => ({
  __esModule: true,
  impactAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}), { virtual: true });

jest.mock('../services/supabase.native', () => ({
  supabase: {
    auth: {
      onAuthStateChange: mockOnAuthStateChange,
      getUser: mockAuthGetUser,
    },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      })),
    })),
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
    })),
    removeChannel: jest.fn(),
  },
}), { virtual: true });

// The session sync makes sure a profile row exists before recording who is
// signed in. The real function talks to Supabase; the suite drives its outcome.
jest.mock('../services/profileBootstrap', () => ({
  ensureCurrentUserProfile: jest.fn(async () => true),
}), { virtual: true });

// features/blocks talks to Supabase and TanStack Query. This suite is about
// the provider, so the feature is stubbed and only the calls the provider
// makes into it are asserted.
const mockMigrateLocalBlocks = jest.fn(async () => null);

// The signed-out placeholder is one object, as the real hook's is, so a
// render that changes nothing hands out the same reference.
const mockPlaceholderProfile = {
  id: '',
  name: 'OneTag User',
  username: 'onetag_user',
  bio: 'Hello, I am using OneTag',
  profilePicture: null,
};

jest.mock('../features/profiles', () => ({
  useCurrentUserQuery: (authUserId: string | undefined) => {
    mockCurrentUserArg = authUserId;
    return { data: undefined, isPending: true, userProfile: mockPlaceholderProfile };
  },
}), { virtual: true });

jest.mock('../features/notifications', () => ({
  useNotificationsRealtime: jest.fn(),
}), { virtual: true });

jest.mock('../features/messages', () => ({
  useMessagesRealtime: jest.fn(),
}), { virtual: true });

jest.mock('../features/blocks', () => ({
  useBlockedUsers: () => ({
    blockedUsers: [],
    isUserBlocked: () => false,
    isUserIdBlocked: () => false,
    query: { data: [], isPending: false },
  }),
  useBlockToggle: () => ({ toggle: jest.fn(), isPending: false }),
  migrateLocalBlocks: (...args: unknown[]) => mockMigrateLocalBlocks(...(args as [])),
  blockKeys: { all: ['blocks'] },
}), { virtual: true });

// ─── 2. Imports under test ──────────────────────────────────────────────
import React, { useEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider, useApp } from '../store/AppContext.native';
import { ensureCurrentUserProfile } from '../services/profileBootstrap';
import { authKeys } from '../features/auth';
type AppContextType = ReturnType<typeof useApp>;

// ─── 3. Helpers ─────────────────────────────────────────────────────────

/**
 * Probe component that captures the current `useApp` value into a ref
 * we can read from the test. We also render a JSON tree of the captured
 * state so failures show useful diff output.
 */
type Captured = { current: AppContextType | null };

const Probe: React.FC<{ capture: Captured }> = ({ capture }) => {
  const ctx = useApp();
  useEffect(() => {
    capture.current = ctx;
  });
  return React.createElement('div', { 'data-testid': 'probe' }, JSON.stringify({
    hasSetIsViewingStory: typeof ctx.setIsViewingStory === 'function',
    hasAddToast: typeof ctx.addToast === 'function',
    theme: ctx.theme,
    userProfileName: ctx.userProfile.name,
    hasIsUserBlocked: typeof ctx.isUserBlocked === 'function',
  }));
};

interface MountedHandle {
  root: Root;
  container: HTMLDivElement;
  capture: Captured;
  queryClient: QueryClient;
}

function mountWithProvider(): MountedHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const capture: Captured = { current: null };
  const root = createRoot(container);
  // AppContext consumes query hooks now (ONE-54), so it needs a client —
  // which mirrors app/_layout.tsx, where QueryProvider is the outer one.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  act(() => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          AppProvider,
          null,
          React.createElement(Probe, { capture }),
        ),
      ),
    );
  });
  return { root, container, capture, queryClient };
}

/**
 * Mount, then flush the provider's post-mount async effects (the
 * AsyncStorage block-list read). Use this when a test asserts on state
 * that arrives after hydration rather than from the initial render.
 */
async function mountAndHydrate(): Promise<MountedHandle> {
  const handle = mountWithProvider();
  await act(async () => {
    await Promise.resolve();
  });
  return handle;
}

function unmount(handle: MountedHandle): void {
  act(() => {
    handle.root.unmount();
  });
  handle.container.remove();
}

// ─── 4. Tests ───────────────────────────────────────────────────────────

/** Flush the viewed-set read, which takes a few microtask hops to land. */
const flushHydration = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
};

const recent = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();


describe('useApp (AppContext) — provider wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Make sure no stale blocked-users value carries over between tests.
    mockAsyncStore = {};
  });

  it('renders children inside the provider without throwing', () => {
    const handle = mountWithProvider();
    try {
      // The probe should be present in the rendered DOM.
      const probe = handle.container.querySelector('[data-testid="probe"]');
      expect(probe).not.toBeNull();
      expect(probe!.textContent).toContain('"hasSetIsViewingStory":true');
    } finally {
      unmount(handle);
    }
  });

  it('exposes the expected default state shape to consumers', () => {
    const handle = mountWithProvider();
    try {
      const ctx = handle.capture.current;
      expect(ctx).not.toBeNull();
      // The provider must hand consumers a fully-initialized state object,
      // not undefined. This guards the "must be used within a provider"
      // contract from the consumer side.
      expect(ctx).toBeDefined();
      // Default user profile (per the AppContext initial state).
      expect(ctx!.userProfile.name).toBe('OneTag User');
      expect(ctx!.userProfile.username).toBe('onetag_user');
      // Default theme.
      expect(ctx!.theme).toBe('dark');
      // Server-owned state is no longer here: likes, reposts and saves live
      // on the cached post entity (ONE-13), and the block list is a query
      // (ONE-54). AppContext holds only UI state no server owns.
      expect(ctx).not.toHaveProperty('likedPosts');
      expect(ctx).not.toHaveProperty('repostedPosts');
      expect(ctx).not.toHaveProperty('savedPosts');
      expect(ctx).not.toHaveProperty('blockedUsers');
      // Unread messages are a query too (ONE-18).
      expect(ctx).not.toHaveProperty('unreadMessageCount');
      expect(ctx).not.toHaveProperty('unreadChats');
      // The session, the admin flag and poll votes left in ONE-20: the first
      // two are queries (features/auth, features/admin), polls never existed.
      expect(ctx).not.toHaveProperty('authUserId');
      expect(ctx).not.toHaveProperty('isAdmin');
      expect(ctx).not.toHaveProperty('votedPolls');
      // The notification list is a query now (ONE-17); the transient
      // top-of-screen banner is UI state and stays.
      expect(ctx).not.toHaveProperty('notifications');
      expect(ctx!.topNotification).toBeNull();
    } finally {
      unmount(handle);
    }
  });

  it('exposes the action functions expected by the context type', () => {
    const handle = mountWithProvider();
    try {
      const ctx = handle.capture.current!;
      // Spot-check a representative slice of the action API. The full
      // surface is huge; we just confirm the provider is actually wiring
      // functions (not returning undefined) for the most-used actions.
      expect(typeof ctx.addToast).toBe('function');
      expect(typeof ctx.removeToast).toBe('function');
      expect(typeof ctx.setTheme).toBe('function');
      // Pull-to-refresh invalidates the queries it needs at its call site.
      expect(ctx).not.toHaveProperty('refreshAllData');
      expect(ctx).not.toHaveProperty('markAllMessagesAsRead');
      expect(ctx).not.toHaveProperty('markChatAsRead');
    } finally {
      unmount(handle);
    }
  });

  it('no longer keeps a block-list of its own (ONE-54)', async () => {
    // A returning device may still hold the old key. The provider does not
    // read it into state any more — it hands it to features/blocks to import
    // once, and `isUserBlocked` answers from the server query after that.
    // The import itself is covered in __tests__/features/blocks.
    mockAsyncStore['onetag-blocked-users'] = JSON.stringify(['spammer1', 'spammer2']);

    const handle = await mountAndHydrate();
    try {
      const ctx = handle.capture.current!;
      expect(ctx).not.toHaveProperty('blockedUsers');
      expect(ctx.isUserBlocked('spammer1')).toBe(false);
    } finally {
      unmount(handle);
    }
  });

  // ─── Stories (ONE-19) ─────────────────────────────────────────────────

  it('holds no story server data, only the viewing flag and the viewed set', () => {
    const handle = mountWithProvider();
    try {
      const ctx = handle.capture.current!;
      for (const removed of [
        'userStories', 'storyComments', 'likedStoryIds', 'hasNewStory',
        'addUserStory', 'deleteStory', 'replaceStory', 'markStoriesViewed',
        'isStoryLiked', 'toggleStoryLike', 'getStoryComments', 'addStoryComment',
        'setStoryComments',
      ]) {
        expect(ctx).not.toHaveProperty(removed);
      }
      expect(ctx.isViewingStory).toBe(false);
      expect(typeof ctx.setIsViewingStory).toBe('function');
      expect(ctx.viewedStoryTimestamps).toBeInstanceOf(Set);
    } finally {
      unmount(handle);
    }
  });

  it('rehydrates the viewed set from AsyncStorage, so a restart keeps it', async () => {
    const seen = recent(30);
    mockAsyncStore['onetag:viewedStoryTimestamps'] = JSON.stringify([seen]);

    const handle = mountWithProvider();
    await flushHydration();
    try {
      expect(handle.capture.current!.isStoryViewed(seen)).toBe(true);
    } finally {
      unmount(handle);
    }
  });

  it('persists a newly viewed story', async () => {
    const handle = mountWithProvider();
    await flushHydration();
    try {
      const seen = recent(5);
      act(() => handle.capture.current!.markStoryAsViewed(seen));
      await flushHydration();

      expect(JSON.parse(mockAsyncStore['onetag:viewedStoryTimestamps'])).toEqual([seen]);
    } finally {
      unmount(handle);
    }
  });

  it.each([
    ['not JSON', '{not json'],
    ['an object', JSON.stringify({ a: 1 })],
    ['null', 'null'],
  ])('tolerates a malformed viewed payload (%s)', async (_label, payload) => {
    mockAsyncStore['onetag:viewedStoryTimestamps'] = payload;

    const handle = mountWithProvider();
    await flushHydration();
    try {
      expect(handle.capture.current!.viewedStoryTimestamps.size).toBe(0);
    } finally {
      unmount(handle);
    }
  });

  it('does not try to import a block-list with nobody signed in', () => {
    // There is no blocker to attribute the rows to, so the migration waits
    // rather than dropping the list on the floor.
    mockAsyncStore['onetag-blocked-users'] = JSON.stringify(['spammer1']);

    const handle = mountWithProvider();
    try {
      expect(mockMigrateLocalBlocks).not.toHaveBeenCalled();
      expect(mockAsyncStore['onetag-blocked-users']).toBe(JSON.stringify(['spammer1']));
    } finally {
      unmount(handle);
    }
  });
});

// ─── Auth session transitions ─────────────────────────────────────────
//
// These replace app-context-dispatch.test.ts, auth-expired-token.test.ts,
// auth-concurrent-sessions.test.ts and the session half of
// auth-flow.integration.test.ts, which asserted against a hand-written copy
// of AppState that had drifted from the real one. Each transition is fired
// through the listener the real provider registers.

describe('useApp (AppContext) — auth session transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStore = {};
    mockCurrentUserArg = undefined;
  });

  /** The provider's onAuthStateChange callback, from the latest mount. */
  const authListener = (): ((event: string, session: unknown) => Promise<void>) => {
    const calls = mockOnAuthStateChange.mock.calls as unknown as [(event: string, session: unknown) => Promise<void>][];
    return calls[calls.length - 1][0];
  };

  const fire = async (event: string, session: unknown) => {
    await act(async () => {
      await authListener()(event, session);
      // TanStack notifies observers on a timeout tick, not synchronously.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const signedIn = { user: { id: 'user-1' } };

  /** The session as features/auth records it in the cache. */
  const sessionOf = (handle: MountedHandle) => handle.queryClient.getQueryData(authKeys.session());

  it('signs in: makes sure the profile row exists, records the session, keys the profile query by it', async () => {
    const handle = mountWithProvider();
    try {
      await fire('SIGNED_IN', signedIn);

      expect(ensureCurrentUserProfile).toHaveBeenCalledTimes(1);
      expect(sessionOf(handle)).toBe('user-1');
      expect(mockCurrentUserArg).toBe('user-1');
    } finally {
      unmount(handle);
    }
  });

  it('treats the session restored on launch as a sign-in', async () => {
    const handle = mountWithProvider();
    try {
      await fire('INITIAL_SESSION', signedIn);
      expect(sessionOf(handle)).toBe('user-1');
    } finally {
      unmount(handle);
    }
  });

  it('signs out: forgets the user, clears every cached query, keeps device-local state', async () => {
    const handle = mountWithProvider();
    await flushHydration();
    try {
      await fire('SIGNED_IN', signedIn);
      act(() => {
        handle.capture.current!.setTheme('light');
        handle.capture.current!.markStoryAsViewed(recent(10));
      });
      handle.queryClient.setQueryData(['posts', 'feed', 'user-1'], { pages: [] });

      await fire('SIGNED_OUT', null);

      const ctx = handle.capture.current!;
      expect(sessionOf(handle)).toBeNull();
      expect(mockCurrentUserArg).toBeUndefined();
      // Everything cached belonged to the previous account.
      expect(handle.queryClient.getQueryData(['posts', 'feed', 'user-1'])).toBeUndefined();
      // Theme is UI state and the viewed set is per device, not per account.
      expect(ctx.theme).toBe('light');
      expect(ctx.viewedStoryTimestamps.size).toBe(1);
    } finally {
      unmount(handle);
    }
  });

  it('a silent token refresh neither re-syncs nor clears anything', async () => {
    const handle = mountWithProvider();
    try {
      await fire('SIGNED_IN', signedIn);
      handle.queryClient.setQueryData(['posts', 'feed', 'user-1'], { pages: [] });
      (ensureCurrentUserProfile as jest.Mock).mockClear();

      await fire('TOKEN_REFRESHED', signedIn);

      expect(ensureCurrentUserProfile).not.toHaveBeenCalled();
      expect(sessionOf(handle)).toBe('user-1');
      expect(handle.queryClient.getQueryData(['posts', 'feed', 'user-1'])).toEqual({ pages: [] });
    } finally {
      unmount(handle);
    }
  });

  it('tells the user when the account sync fails, and stays signed out of the session', async () => {
    (ensureCurrentUserProfile as jest.Mock).mockRejectedValueOnce(new Error('network'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const handle = mountWithProvider();
    try {
      await fire('SIGNED_IN', signedIn);

      const ctx = handle.capture.current!;
      expect(sessionOf(handle)).toBeUndefined();
      expect(ctx.toasts.map((t) => t.type)).toContain('error');
    } finally {
      unmount(handle);
      errorSpy.mockRestore();
    }
  });

  it('setTheme changes the theme and nothing else', () => {
    const handle = mountWithProvider();
    try {
      const before = handle.capture.current!;
      act(() => before.setTheme('light'));

      const after = handle.capture.current!;
      expect(after.theme).toBe('light');
      expect(after.userProfile).toBe(before.userProfile);
      expect(after.toasts).toBe(before.toasts);
      expect(after.viewedStoryTimestamps).toBe(before.viewedStoryTimestamps);
    } finally {
      unmount(handle);
    }
  });
});

describe('useApp (AppContext) — error when used outside provider', () => {
  // We suppress React's expected error log so the test output stays
  // readable. The provider's error path is exactly the thing we're
  // asserting on, so it WILL be logged by React.
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('throws a descriptive error when the hook is called without an AppProvider ancestor', () => {
    // The hook throws synchronously during render. createRoot surfaces
    // the error from the synchronous part of the render through React's
    // error logging, so we must capture it via console.error AND inspect
    // the captured value of the thrown Error.
    let caught: Error | null = null;
    const OutsideProbe: React.FC = () => {
      try {
        useApp();
      } catch (e) {
        caught = e as Error;
      }
      return null;
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(OutsideProbe));
    });
    try {
      expect(caught).not.toBeNull();
      expect(caught!.message).toMatch(/useApp must be used within an AppProvider/);
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('the thrown error mentions the required provider by name', () => {
    // A second assertion on the same behavior with a tighter regex.
    // This guards against accidental rewording of the error message
    // that could mislead developers who hit it in production.
    let caught: Error | null = null;
    const OutsideProbe: React.FC = () => {
      try {
        useApp();
      } catch (e) {
        caught = e as Error;
      }
      return null;
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(OutsideProbe));
    });
    try {
      expect(caught).not.toBeNull();
      expect(caught!.message).toMatch(/AppProvider/);
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});

// ─── 5. Publishing moved out (ONE-15) ───────────────────────────────────
//
// `addProfilePost` lived here to keep a `profilePosts` array in step. That
// array is a query now, so publishing is `useCreatePost` in features/posts and
// the composer maps the failure to its message. What that leaves the provider
// is nothing — asserted here so it is not quietly added back.

describe('post writes are not on the context any more', () => {
  it.each(['addProfilePost', 'deleteProfilePost', 'updateProfilePost', 'setProfilePosts'])(
    'does not expose %s',
    (name) => {
      const handle = mountWithProvider();
      try {
        expect(handle.capture.current!).not.toHaveProperty(name);
      } finally {
        unmount(handle);
      }
    },
  );

  it.each(['userProfile'])('still exposes %s, because it is the identity object', (name) => {
    // ONE-15 moved it to a query but deliberately kept it on the context, and
    // kept the placeholder's empty-string id, so `userProfile?.id` guards —
    // push-notification registration above all — behave as they did.
    const handle = mountWithProvider();
    try {
      expect(handle.capture.current!).toHaveProperty(name);
      expect(handle.capture.current!.userProfile.id).toBe('');
      expect(handle.capture.current!.userProfile.username).toBe('onetag_user');
    } finally {
      unmount(handle);
    }
  });

  it.each(['notifications', 'markAllNotificationsAsRead'])(
    'does not expose %s — notifications are a query now (ONE-17)',
    (name) => {
      const handle = mountWithProvider();
      try {
        expect(handle.capture.current!).not.toHaveProperty(name);
      } finally {
        unmount(handle);
      }
    },
  );

  it('keeps the transient top notification, which no server owns', () => {
    const handle = mountWithProvider();
    try {
      expect(handle.capture.current!).toHaveProperty('topNotification');
      expect(typeof handle.capture.current!.showTopNotification).toBe('function');
    } finally {
      unmount(handle);
    }
  });

  it.each(['postComments', 'getComments', 'setComments', 'areCommentsLoaded', 'postComment'])(
    'does not expose %s — comments are a query now (ONE-14)',
    (name) => {
      const handle = mountWithProvider();
      try {
        expect(handle.capture.current!).not.toHaveProperty(name);
      } finally {
        unmount(handle);
      }
    },
  );

  it.each(['followedUsernames', 'isUserFollowed', 'toggleFollowUser', 'updateProfile'])(
    'does not expose %s — follows and profile edits are features/profiles now',
    (name) => {
      const handle = mountWithProvider();
      try {
        expect(handle.capture.current!).not.toHaveProperty(name);
      } finally {
        unmount(handle);
      }
    },
  );
});
