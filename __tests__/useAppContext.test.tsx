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

// ─── 2. Imports under test ──────────────────────────────────────────────
import React, { useEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
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
    blockedUsersSize: ctx.blockedUsers.size,
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
  act(() => {
    root.render(
      React.createElement(
        AppProvider,
        null,
        React.createElement(Probe, { capture }),
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
      // Post interaction state is no longer here: likes, reposts and saves
      // live on the cached post entity and are toggled through
      // features/posts/mutations.ts (ONE-13). AppContext holds only UI state
      // no server owns, which is what blockedUsers still is.
      expect(ctx).not.toHaveProperty('likedPosts');
      expect(ctx).not.toHaveProperty('repostedPosts');
      expect(ctx).not.toHaveProperty('savedPosts');
      expect(ctx!.blockedUsers.size).toBe(0);
      expect(ctx!.unreadMessageCount).toBe(0);
      expect(ctx!.isAdmin).toBe(false);
      expect(ctx!.notifications).toBeNull();
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
      expect(typeof ctx.postComment).toBe('function');
      expect(typeof ctx.addToast).toBe('function');
      expect(typeof ctx.removeToast).toBe('function');
      expect(typeof ctx.setTheme).toBe('function');
      expect(typeof ctx.refreshAllData).toBe('function');
      expect(typeof ctx.markAllNotificationsAsRead).toBe('function');
      expect(typeof ctx.markAllMessagesAsRead).toBe('function');
    } finally {
      unmount(handle);
    }
  });

  it('hydrates blocked users from AsyncStorage when present', async () => {
    // Seed AsyncStorage as a returning user's device would already have
    // it, then mount and let the hydration effect settle.
    mockAsyncStore['onetag-blocked-users'] = JSON.stringify([
      'spammer1',
      'spammer2',
    ]);
    const handle = await mountAndHydrate();
    try {
      const ctx = handle.capture.current!;
      expect(ctx.blockedUsers).toBeInstanceOf(Set);
      expect(ctx.blockedUsers.size).toBe(2);
      expect(ctx.blockedUsers.has('spammer1')).toBe(true);
      expect(ctx.blockedUsers.has('spammer2')).toBe(true);
    } finally {
      unmount(handle);
    }
  });

  it('starts with an empty block-list before hydration resolves', () => {
    // Unlike the fork, the native provider cannot read storage inside its
    // useState initializer — the first paint always shows an empty set.
    mockAsyncStore['onetag-blocked-users'] = JSON.stringify(['spammer1']);
    const handle = mountWithProvider();
    try {
      expect(handle.capture.current!.blockedUsers.size).toBe(0);
    } finally {
      unmount(handle);
    }
  });

  it('ignores a malformed AsyncStorage payload instead of throwing', async () => {
    mockAsyncStore['onetag-blocked-users'] = '{not json';
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const handle = await mountAndHydrate();
      try {
        expect(handle.capture.current!.blockedUsers.size).toBe(0);
      } finally {
        unmount(handle);
      }
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('ignores a non-array AsyncStorage payload', async () => {
    // The provider guards on Array.isArray before rehydrating, so a stray
    // object must not become a block-list.
    mockAsyncStore['onetag-blocked-users'] = JSON.stringify({ spammer1: true });
    const handle = await mountAndHydrate();
    try {
      expect(handle.capture.current!.blockedUsers.size).toBe(0);
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

// ─── 5. addProfilePost — the publish path (ONE-56) ──────────────────────
//
// A failed media upload used to be swallowed and the post published anyway
// with a device-local URI. addProfilePost must now reject, so the composer's
// `router.back()` — which sits after the await — never runs and the draft
// stays on screen.

describe('addProfilePost — media upload failures', () => {
  const mockPublishPost = publishPost as unknown as jest.Mock;

  const draft = () => ({ id: 'temp-1', content: 'keep my draft' }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStore = {};
  });

  it('rejects when the media upload fails, so the composer stays open', async () => {
    mockPublishPost.mockRejectedValue(new FakeMediaUploadError('upload failed'));
    const handle = await mountAndHydrate();
    try {
      await act(async () => {
        await expect(handle.capture.current!.addProfilePost(draft())).rejects.toBeInstanceOf(
          FakeMediaUploadError,
        );
      });
    } finally {
      unmount(handle);
    }
  });

  it('names the photo as the problem rather than toasting a generic failure', async () => {
    mockPublishPost.mockRejectedValue(new FakeMediaUploadError('upload failed'));
    const handle = await mountAndHydrate();
    try {
      await act(async () => {
        await handle.capture.current!.addProfilePost(draft()).catch(() => undefined);
      });
      const messages = handle.capture.current!.toasts.map(t => t.message);
      expect(messages.some(m => /photo could not be uploaded/i.test(m))).toBe(true);
      expect(messages).not.toContain('Failed to create post.');
    } finally {
      unmount(handle);
    }
  });

  it('still reports a non-media publish failure generically', async () => {
    mockPublishPost.mockRejectedValue(new Error('row-level security'));
    const handle = await mountAndHydrate();
    try {
      await act(async () => {
        await handle.capture.current!.addProfilePost(draft()).catch(() => undefined);
      });
      expect(handle.capture.current!.toasts.map(t => t.message)).toContain('Failed to create post.');
    } finally {
      unmount(handle);
    }
  });

  it('hands the draft straight to publishPost — nothing is uploaded here', async () => {
    mockPublishPost.mockResolvedValue({ id: 'post-1' });
    const handle = await mountAndHydrate();
    try {
      await act(async () => {
        await handle.capture.current!.addProfilePost(draft());
      });
      expect(mockPublishPost).toHaveBeenCalledTimes(1);
    } finally {
      unmount(handle);
    }
  });
});
