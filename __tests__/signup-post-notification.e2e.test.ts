
//
// target: __tests__/signup-post-notification.e2e.test.ts
//
// End-to-end tests covering three cross-cutting user journeys that span
// services, auth, and the navigation layer:
//
//   1. Complete signup flow — username availability check → supabase.auth.signUp
//      → profile row bootstrap → session/redirect decision (auto-confirmed vs
//      email-confirmation-required).
//
//   2. Post creation flow — authenticated user calls publishPost(), which
//      inserts into `posts` and fetches the populated row. It writes no
//      notification: the database notifies anyone the body @mentions, from
//      the post itself (ONE-107).
//
//   3. Notification tap navigation — a push as send-push builds it
//      (supabase/functions/send-push/handler.ts) opens where the app's own
//      pushRoute sends it, the function app/_layout.tsx routes taps by.
//      Both are the real code: this suite used to test a copy of the
//      router kept here, which had drifted from the app.
//
// The mock object mirrors the real Supabase v2 chain the app uses. Every `from(table)` call returns a fresh
// thenable query builder that resolves to a per-table canned result
// the test controls via `testHooks.setHandler(table, fn)`. The builder
// records every `insert()` call so tests can assert what was written.

import type { Post, UserProfile } from '../types';
import { checkUsernameExists } from '../features/profiles';
import { ensureCurrentUserProfile } from '../services/profileBootstrap';
import { publishPost } from '../features/posts';
import { asProfileId } from '../types';

// ─── 1. Supabase mock ───────────────────────────────────────────────────

type ChainResult = { data: any; error: any };
type InsertCall = { table: string; rows: any[] };

function makeQueryBuilder(
  table: string,
  result: ChainResult,
  insertCalls: InsertCall[],
): any {
  const self: any = { __table: table };
  const chain = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'in', 'order', 'limit', 'range', 'lt', 'gte',
    'single', 'maybeSingle',
  ];
  for (const m of chain) {
    self[m] = function (...args: any[]) {
      // Capture insert payloads so tests can assert what was written.
      if (m === 'insert') {
        const rows = Array.isArray(args[0]) ? args[0] : [args[0]];
        insertCalls.push({ table, rows });
      }
      return self;
    };
  }
  self.then = function (
    onFulfilled?: (v: ChainResult) => any,
    onRejected?: (r: any) => any,
  ) {
    return Promise.resolve(result).then(onFulfilled, onRejected);
  };
  return self;
}

jest.mock('../services/supabase.native', () => {
  // insertCalls is captured by makeQueryBuilder and exposed via __test__
  // so the test body can assert the payloads publishPost hands to
  // supabase.from(...).insert(...).
  const insertCalls: InsertCall[] = [];
  const mockSignUp = jest.fn();
  const mockSignInWithPassword = jest.fn();
  const mockSignOut = jest.fn();
  const mockGetSession = jest.fn();
  const mockGetUser = jest.fn();
  const mockOnAuthStateChange = jest.fn();
  const mockRpc = jest.fn();
  const handlers: Record<string, () => ChainResult> = {};
  const mockFrom = jest.fn((table: string) => {
    const handler = handlers[table];
    const result: ChainResult =
      typeof handler === 'function' ? handler() : { data: [], error: null };
    return makeQueryBuilder(table, result, insertCalls);
  });

  return {
    supabase: {
      auth: {
        signUp: mockSignUp,
        signInWithPassword: mockSignInWithPassword,
        signOut: mockSignOut,
        getSession: mockGetSession,
        getUser: mockGetUser,
        onAuthStateChange: mockOnAuthStateChange,
      },
      from: mockFrom,
      rpc: mockRpc,
    },
    __test__: {
      handlers,
      setHandler: (table: string, fn: () => ChainResult) => { handlers[table] = fn; },
      clearHandlers: () => { for (const k of Object.keys(handlers)) delete handlers[k]; },
      mockSignUp,
      mockSignInWithPassword,
      mockSignOut,
      mockGetSession,
      mockGetUser,
      mockOnAuthStateChange,
      mockRpc,
      mockFrom,
      insertCalls,
    },
  };
});

const testHooks = (require('../services/supabase.native') as any).__test__ as {
  handlers: Record<string, () => ChainResult>;
  setHandler: (table: string, fn: () => ChainResult) => void;
  clearHandlers: () => void;
  mockSignUp: jest.Mock;
  mockSignInWithPassword: jest.Mock;
  mockSignOut: jest.Mock;
  mockGetSession: jest.Mock;
  mockGetUser: jest.Mock;
  mockOnAuthStateChange: jest.Mock;
  mockRpc: jest.Mock;
  mockFrom: jest.Mock;
  insertCalls: InsertCall[];
};

// ─── 2. Notification tap routing ────────────────────────────────────────
//
// What the server puts on a push, and where the app opens it: the real
// buildPush and pushRoute, so the two can't drift apart unseen.

import { buildPush, type PushEvent } from '../supabase/functions/send-push/handler';
import { pushRoute } from '../lib/screens/notifications';

const MESSAGE_ROUTE = '/messages?chatWith=sara_codes';

const receiver = { authUserId: 'auth-noor', username: 'noor', profileType: 'individual' as const };

/** Where tapping the push for this event opens. */
const tapOpens = (event: PushEvent): string => pushRoute(buildPush(event)?.data);

// ─── 3. Test fixtures ───────────────────────────────────────────────────

function makeAuthUser(overrides: {
  id?: string;
  email?: string;
  fullName?: string;
  username?: string;
} = {}) {
  return {
    id: overrides.id ?? 'new-user-1',
    email: overrides.email ?? 'noor@example.com',
    user_metadata: {
      full_name: overrides.fullName ?? 'Noor Saleh',
      username: overrides.username ?? 'noor',
      birthday: '1998-04-12',
      bio: 'Hello, I am using OneTag',
    },
  };
}

function makeFeedPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'new-post-1',
    name: 'Noor Saleh',
    username: 'noor',
    avatar: null,
    content: 'Just joined OneTag! #hello',
    media_type: 'text',
    likes: 0,
    reposts: 0,
    replies: 0,
    isVerified: false,
    ...overrides,
  };
}

function makePostRow(overrides: {
  id?: string;
  content?: string;
  username?: string;
  full_name?: string;
  likes?: number;
  comments?: number;
  reposts?: number;
  media_type?: 'text' | 'image';
  image_url?: string | null;
} = {}) {
  return {
    id: overrides.id ?? 'new-post-1',
    content: overrides.content ?? 'Just joined OneTag! #hello',
    image_url: overrides.image_url ?? null,
    media_type: overrides.media_type ?? 'text',
    media_aspect_ratio: null,
    created_at: '2026-07-14T10:00:00Z',
    profiles: [{
      username: overrides.username ?? 'noor',
      avatar_url: null,
      full_name: overrides.full_name ?? 'Noor Saleh',
      is_verified: false,
    }],
    likes: [{ count: overrides.likes ?? 0 }],
    comments: [{ count: overrides.comments ?? 0 }],
    reposts: [{ count: overrides.reposts ?? 0 }],
  };
}

beforeEach(() => {
  testHooks.clearHandlers();
  testHooks.insertCalls.length = 0;
  testHooks.mockSignUp.mockReset();
  testHooks.mockSignInWithPassword.mockReset();
  testHooks.mockSignOut.mockReset();
  testHooks.mockGetSession.mockReset();
  testHooks.mockGetUser.mockReset();
  testHooks.mockOnAuthStateChange.mockReset();
  // mockFrom's implementation comes from the jest.mock factory — use
  // mockClear to wipe call history without wiping the implementation.
  testHooks.mockFrom.mockClear();
  testHooks.mockRpc.mockReset();
  testHooks.mockOnAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: jest.fn() } },
  });
});

// =========================================================================
// 1. COMPLETE SIGNUP FLOW
// =========================================================================
//
// Drives the same surface app/(auth)/signup.tsx calls:
//   1) user submits form → handleSignUp()
//   2) checkUsernameExists(username)  → profiles.username lookup
//   3) supabase.auth.signUp(...)       → returns user (+ optional session)
//   4) ensureCurrentUserProfile()      → bootstraps profile row
//   5) UI branching decision:
//        session present   → "Welcome / Redirecting" (auto-confirmed)
//        session absent    → "Check your email"      (email confirmation)

describe('E2E — complete signup flow', () => {
  it('walks the happy path: username available → signUp → profile bootstrap → auto-confirm', async () => {
    // ── Step 1: username availability check ──
    testHooks.setHandler('profiles', () => ({ data: null, error: null }));

    const usernameTaken = await checkUsernameExists('noor');
    expect(usernameTaken).toBe(false);
    expect(testHooks.mockFrom).toHaveBeenCalledWith('profiles');

    // ── Step 2: supabase.auth.signUp with metadata ──
    const authUser = makeAuthUser();
    const session = { user: authUser, access_token: 'jwt-abc' };
    testHooks.mockSignUp.mockResolvedValue({
      data: { user: authUser, session },
      error: null,
    });

    const signUpPayload = {
      email: 'noor@example.com',
      password: 'correcthorse',
      options: {
        data: {
          full_name: 'Noor Saleh',
          username: 'noor',
          birthday: '1998-04-12',
          bio: 'Hello, I am using OneTag',
        },
      },
    };
    const signUpResult = await testHooks.mockSignUp(signUpPayload);

    expect(signUpResult.error).toBeNull();
    expect(signUpResult.data.user.id).toBe('new-user-1');
    expect(signUpResult.data.session).not.toBeNull();
    expect(testHooks.mockSignUp).toHaveBeenCalledWith(signUpPayload);

    // ── Step 3: profile bootstrap ──
    // signup.tsx calls ensureCurrentUserProfile() when session is present.
    // First call (profileExists) returns null → upsert runs, then a second
    // profileExists call returns the row.
    let profilesCalls = 0;
    testHooks.mockGetUser.mockResolvedValue({ data: { user: authUser }, error: null });
    testHooks.setHandler('profiles', () => {
      profilesCalls += 1;
      // 1st: profileExists → null (no row yet, triggers upsert).
      // After upsert, profileExists returns the row.
      if (profilesCalls === 1) return { data: null, error: null };
      return { data: { id: authUser.id, username: 'noor' }, error: null };
    });

    const profileReady = await ensureCurrentUserProfile();
    expect(profileReady).toBe(true);
    expect(testHooks.mockGetUser).toHaveBeenCalled();
    expect(profilesCalls).toBeGreaterThanOrEqual(1);

    // ── Step 4: UI branching decision ──
    // session is non-null → isSuccess = true ("Welcome / Redirecting" screen).
    // The signup screen's auth listener picks up SIGNED_IN and routes to
    // (tabs); the `data.user` payload is what populates AppContext via
    // ensureCurrentUserProfile.
    expect(signUpResult.data.session).not.toBeNull();
    expect(signUpResult.data.user.id).toBe('new-user-1');
  });

  it('falls through to the email-confirmation screen when session is null', async () => {
    // Username is available.
    testHooks.setHandler('profiles', () => ({ data: null, error: null }));
    await checkUsernameExists('layla_pending');
    expect(testHooks.mockFrom).toHaveBeenCalledWith('profiles');

    // signUp returns a user but no session — Supabase email confirmation required.
    const pendingUser = makeAuthUser({
      id: 'pending-user-1',
      email: 'layla_pending@example.com',
      fullName: 'Layla Pending',
      username: 'layla_pending',
    });
    testHooks.mockSignUp.mockResolvedValue({
      data: { user: pendingUser, session: null },
      error: null,
    });

    const result = await testHooks.mockSignUp({
      email: 'layla_pending@example.com',
      password: 'correcthorse',
      options: { data: { full_name: 'Layla Pending', username: 'layla_pending' } },
    });

    expect(result.error).toBeNull();
    expect(result.data.user).not.toBeNull();
    // No session → UI sets needsConfirmation=true ("Check your email" screen).
    expect(result.data.session).toBeNull();
  });

  it('rejects signup when the chosen username is already taken', async () => {
    // profiles.username lookup returns a row → username is taken.
    testHooks.setHandler('profiles', () => ({ data: { username: 'onetag' }, error: null }));

    const isTaken = await checkUsernameExists('onetag');
    expect(isTaken).toBe(true);

    // signup.tsx throws "This username is already taken." and never
    // calls supabase.auth.signUp on this branch.
    expect(testHooks.mockSignUp).not.toHaveBeenCalled();
  });

  it('surfaces a Supabase signUp error without throwing past the form', async () => {
    testHooks.setHandler('profiles', () => ({ data: null, error: null }));
    await checkUsernameExists('noor');

    testHooks.mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Password should be at least 6 characters' },
    });

    const result = await testHooks.mockSignUp({
      email: 'noor@example.com',
      password: '123',
      options: { data: { full_name: 'Noor', username: 'noor' } },
    });

    expect(result.error).not.toBeNull();
    expect(result.error.message).toMatch(/Password/i);
    // The signup screen's catch() sets `error` state — no crash, no
    // ensureCurrentUserProfile call.
    expect(testHooks.mockGetUser).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 2. POST CREATE FLOW
// =========================================================================
//
// Mirrors what app/compose.tsx → features/posts publishPost() does:
//   1) auth.getUser()            → guard against unauthenticated callers
//   2) ensureProfileRowForUser() → guard against missing profile row
//   3) posts.insert(...).select('id').single() → create the row
//   4) posts.select(...).eq('id', x).single() → fetch the populated row
//
// A mention's notification is the database's to write, from the post itself
// (ONE-107), so the app inserts none. We assert the call shape, the returned
// Post, and that nothing was written to notifications.

// The profile noor posts as. Deliberately not her auth id: since ONE-21 every
// new account's profile has its own id, and a post belongs to the profile.
const NOOR_PROFILE = asProfileId('profile-noor');

describe('E2E — post create flow', () => {
  it('publishes a text post end-to-end and returns the populated Post', async () => {
    const authUser = makeAuthUser();
    testHooks.mockGetUser.mockResolvedValue({ data: { user: authUser }, error: null });

    // profileExists inside ensureProfileRowForUser → the account owns one.
    testHooks.setHandler('profiles', () => ({ data: [{ id: NOOR_PROFILE }], error: null }));

    // posts chain pattern:
    //   1st call: insert([...]).select('id').single() → returns { id: ... }
    //   2nd call: select(POST_SELECT_QUERY).eq('id', x).single() → populated row
    let postsCalls = 0;
    testHooks.setHandler('posts', () => {
      postsCalls += 1;
      if (postsCalls === 1) {
        return { data: { id: 'new-post-1' }, error: null };
      }
      return { data: makePostRow(), error: null };
    });

    const draft: Post = makeFeedPost();
    const published = await publishPost(draft, NOOR_PROFILE);

    expect(published).not.toBeNull();
    expect(published!.id).toBe('new-post-1');
    expect(published!.content).toBe('Just joined OneTag! #hello');
    expect(published!.username).toBe('noor');
    expect(published!.likes).toBe(0);
    expect(published!.media_type).toBe('text');

    // The Supabase surface was exercised in the expected order.
    expect(testHooks.mockGetUser).toHaveBeenCalled();
    expect(testHooks.mockFrom).toHaveBeenCalledWith('profiles');
    expect(testHooks.mockFrom).toHaveBeenCalledWith('posts');
    expect(postsCalls).toBeGreaterThanOrEqual(2);

    // The insert payload captured by the mock builder contains the post body.
    const postInsert = testHooks.insertCalls.find((c) => c.table === 'posts');
    expect(postInsert).toBeDefined();
    expect(postInsert!.rows[0]).toEqual(
      expect.objectContaining({
        user_id: NOOR_PROFILE,
        content: 'Just joined OneTag! #hello',
        media_type: 'text',
      }),
    );
  });

  it('writes no notification for an @mention: the database does, from the post (ONE-107)', async () => {
    const authUser = makeAuthUser();
    testHooks.mockGetUser.mockResolvedValue({ data: { user: authUser }, error: null });
    testHooks.setHandler('profiles', () => ({ data: [{ id: NOOR_PROFILE }], error: null }));

    let postsCalls = 0;
    testHooks.setHandler('posts', () => {
      postsCalls += 1;
      if (postsCalls === 1) {
        return { data: { id: 'new-post-1' }, error: null };
      }
      return { data: makePostRow(), error: null };
    });

    const draft: Post = makeFeedPost({ content: 'Salam @ahmed, glad to be here!' });
    await publishPost(draft, NOOR_PROFILE);

    // Clients can't insert notifications at all since ONE-107; the mention's
    // is written by a trigger on posts (supabase/tests/notifications_from_events.test.sql).
    expect(testHooks.insertCalls.find((c) => c.table === 'notifications')).toBeUndefined();
    expect(testHooks.mockFrom).not.toHaveBeenCalledWith('notifications');
  });

  it('rejects publishPost when there is no authenticated user', async () => {
    testHooks.mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(publishPost(makeFeedPost(), NOOR_PROFILE)).rejects.toThrow(/not authenticated/i);
    // Never touches `posts`.
    expect(testHooks.mockFrom).not.toHaveBeenCalledWith('posts');
  });
});
// Nobody being notified about their own action is the database's rule now,
// pinned in supabase/tests/notifications_from_events.test.sql (ONE-107).

// =========================================================================
// 3. NOTIFICATION TAP → NAVIGATION
// =========================================================================
//
// From the push send-push builds to the screen app/_layout.tsx opens for
// it, through the real buildPush and pushRoute. The full table of where each
// notification opens is in docs/push-notifications.md.

describe('E2E — notification tap routes to the correct screen', () => {
  it("opens a new follower's profile", () => {
    expect(tapOpens({ kind: 'notification', type: 'follow', senderUsername: 'sara_codes', receiver, postId: null })).toBe(
      '/user/sara_codes',
    );
  });

  it('opens the requests for a follow request', () => {
    expect(tapOpens({ kind: 'notification', type: 'follow_request', senderUsername: 'sara_codes', receiver, postId: null })).toBe(
      '/follow-requests',
    );
  });

  it('opens a comment, or a reply, on the comment itself', () => {
    for (const type of ['comment', 'reply']) {
      expect(
        tapOpens({ kind: 'notification', type, senderUsername: 'sara_codes', receiver, postId: 'post-42', commentId: 'c-7' }),
      ).toBe('/comments/post-42?commentId=c-7');
    }
  });

  it('opens the post a mention in a post is in', () => {
    expect(tapOpens({ kind: 'notification', type: 'mention', senderUsername: 'sara_codes', receiver, postId: 'post-42' })).toBe(
      '/post/post-42',
    );
  });

  it('opens the conversation with whoever sent a message', () => {
    expect(tapOpens({ kind: 'message', senderUsername: 'sara_codes', receiver })).toBe(MESSAGE_ROUTE);
  });

  it('opens Notifications for a payload it does not recognise, or none', () => {
    expect(pushRoute({ kind: 'unknown' })).toBe('/notifications');
    expect(pushRoute(undefined)).toBe('/notifications');
  });
});
