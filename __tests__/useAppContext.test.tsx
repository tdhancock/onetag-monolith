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
 *   - We use `react-dom/client` + `react-dom/test-utils` (createRoot +
 *     act) instead of `react-test-renderer`, which is deprecated in
 *     React 19. jsdom supplies the DOM; we mount into a transient
 *     container element.
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

// Mock the apiService that AppContext.native.tsx pulls in. We provide a no-op
// shape for every named import the file references. The provider uses
// some of these inside useCallbacks that aren't invoked by these tests,
// but the import must resolve cleanly. The `supabase` re-export is
// forwarded to the mock above so the provider's effects can call
// `supabase.auth.onAuthStateChange` against a fully-shaped client.
class FakeMediaUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaUploadError';
  }
}

jest.mock('../services/apiService', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { supabase } = require('../services/supabase.native');
  return {
    MediaUploadError: FakeMediaUploadError,
    publishPost: jest.fn(),
    deletePost: jest.fn(),
    updatePost: jest.fn(),
    supabase,
    toggleLike: jest.fn(),
    toggleRepost: jest.fn(),
    addComment: jest.fn(),
    getFollowingList: jest.fn(async () => []),
    unfollowUser: jest.fn(),
    followUser: jest.fn(),
    markNotificationsAsRead: jest.fn(),
    getMyStories: jest.fn(async () => []),
    deleteStoryFromDatabase: jest.fn(),
    toggleStoryLikeInDatabase: jest.fn(),
    markMessagesAsRead: jest.fn(),
    toggleSavePost: jest.fn(),
    adminDeletePost: jest.fn(),
    ensureCurrentUserProfile: jest.fn(),
  };
}, { virtual: true });

// features/blocks talks to Supabase and TanStack Query. This suite is about
// the provider, so the feature is stubbed and only the calls the provider
// makes into it are asserted.
const mockMigrateLocalBlocks = jest.fn(async () => null);

jest.mock('../features/profiles', () => ({
  useCurrentUserQuery: () => ({
    data: undefined,
    isPending: true,
    userProfile: {
      id: '',
      name: 'OneTag User',
      username: 'onetag_user',
      bio: 'Hello, I am using OneTag',
      profilePicture: null,
    },
  }),
}), { virtual: true });

jest.mock('../features/notifications', () => ({
  useNotificationsRealtime: jest.fn(),
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
import { act } from 'react-dom/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider, useApp } from '../store/AppContext.native';
import { publishPost } from '../services/apiService';
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
    hasToggleStoryLike: typeof ctx.toggleStoryLike === 'function',
    hasAddToast: typeof ctx.addToast === 'function',
    theme: ctx.theme,
    userProfileName: ctx.userProfile.name,
    hasIsUserBlocked: typeof ctx.isUserBlocked === 'function',
    unreadMessageCount: ctx.unreadMessageCount,
    isAdmin: ctx.isAdmin,
  }));
};

interface MountedHandle {
  root: Root;
  container: HTMLDivElement;
  capture: Captured;
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
  return { root, container, capture };
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
      expect(probe!.textContent).toContain('"hasToggleStoryLike":true');
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
      expect(ctx!.unreadMessageCount).toBe(0);
      expect(ctx!.isAdmin).toBe(false);
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
      expect(typeof ctx.refreshAllData).toBe('function');
      expect(typeof ctx.markAllMessagesAsRead).toBe('function');
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
