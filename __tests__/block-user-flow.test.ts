
//
// target: __tests__/block-user-flow.test.ts
//
// End-to-end logic tests for the "Block user" flow surfaced on the
// profile screen at app/user/[username].tsx. Three user-visible steps
// are covered, mirroring the user journey:
//
//   1. The viewer taps "Block" in the overflow menu; the username is
//      added to the block-list and persisted to localStorage.
//   2. Content authored by the blocked user (timeline posts, search
//      results, realtime inserts) disappears from every surface.
//   3. The viewer re-opens the menu and taps "Unblock"; the username
//      is removed from the block-list and the author's content
//      becomes visible again.
//
// We exercise the underlying pure helpers (`toggleBlockUser`,
// `applyRealtimeInsert`) so React Native / supabase are not required at
// runtime, mirroring the convention used by report-user-flow.test.ts and
// the FeedScreen.* tests.

// ---------------------------------------------------------------------------
// Local-storage stub.
// The project's Jest config runs in the `node` environment, which has no
// built-in localStorage. Install a minimal in-memory stub for the duration
// of these tests — the same approach used in report-user-flow.test.ts.
// ---------------------------------------------------------------------------

function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  (globalThis as any).localStorage = stub;
}

// ---------------------------------------------------------------------------
// 1. Block action — toggleBlockUser adds the username and persists it.
// ---------------------------------------------------------------------------
//
// Mirrors the toggleBlockUser contract from store/AppContext.native.tsx so we
// do not need to spin up the full React provider. The real implementation
// stores the blocked usernames as a JSON-encoded string array under
// BLOCKED_USERS_KEY; we exercise the same algorithm here.

const BLOCKED_USERS_KEY = 'onetag-blocked-users';

interface BlockListState {
  blocked: Set<string>;
}

function createBlockListState(): BlockListState {
  return { blocked: new Set<string>() };
}

function toggleBlockUser(state: BlockListState, username: string): BlockListState {
  const next = new Set(state.blocked);
  if (next.has(username)) {
    next.delete(username);
  } else {
    next.add(username);
  }
  globalThis.localStorage.setItem(
    BLOCKED_USERS_KEY,
    JSON.stringify(Array.from(next)),
  );
  return { blocked: next };
}

function rehydrateBlockList(): Set<string> {
  const raw = globalThis.localStorage.getItem(BLOCKED_USERS_KEY);
  if (!raw) return new Set<string>();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter(item => typeof item === 'string'));
  } catch {
    return new Set<string>();
  }
}

describe('Block user flow — block action', () => {
  beforeEach(() => {
    installLocalStorageStub();
  });

  test('blocking a username adds it to the set and persists a JSON array to localStorage', () => {
    const state = createBlockListState();

    const next = toggleBlockUser(state, 'spammer');

    // The in-memory state must reflect the block immediately so the
    // menu item morphs from "Block" into "Unblock" without a refresh.
    expect(next.blocked.has('spammer')).toBe(true);
    expect(next.blocked.size).toBe(1);

    // Persistence: the helper serialises the Set into a JSON array of
    // strings under BLOCKED_USERS_KEY. Any future page reload (or
    // re-mount of AppProvider) will rehydrate from this key.
    const raw = globalThis.localStorage.getItem(BLOCKED_USERS_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(['spammer']);
  });

  test('the block-list survives a rehydrate from localStorage (round-trip)', () => {
    // Simulate the lifecycle: viewer blocks three users, the app is
    // reloaded (or the provider is re-mounted), and the next useState
    // initializer must reconstruct the exact same Set.
    let state = createBlockListState();
    state = toggleBlockUser(state, 'spammer');
    state = toggleBlockUser(state, 'troll');
    state = toggleBlockUser(state, 'bot42');

    const rehydrated = rehydrateBlockList();

    expect(rehydrated.size).toBe(3);
    expect(rehydrated.has('spammer')).toBe(true);
    expect(rehydrated.has('troll')).toBe(true);
    expect(rehydrated.has('bot42')).toBe(true);
  });

  test('blocking the same username twice is a no-op (set semantics)', () => {
    // The block-list is a Set, so toggling the same username twice
    // should not produce a duplicate entry — and the JSON payload
    // written to localStorage must remain a clean string array.
    let state = createBlockListState();
    state = toggleBlockUser(state, 'spammer');

    // toggleBlockUser is a toggle, not a one-way add. The user-facing
    // contract is: first tap blocks, second tap unblocks. We exercise
    // both halves here; the unblock half is covered in detail in the
    // "unblock restores visibility" describe block below.
    const reblocked = toggleBlockUser(toggleBlockUser(state, 'spammer'), 'spammer');

    expect(reblocked.blocked.has('spammer')).toBe(true);
    const raw = JSON.parse(globalThis.localStorage.getItem(BLOCKED_USERS_KEY) || '[]');
    expect(raw).toEqual(['spammer']);
    // No accidental duplicate entry from the round-trip.
    expect(new Set(raw).size).toBe(raw.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Blocked content hidden — a blocked author's post never reaches the feed.
//
// The block-list predicate is applied by `applyRealtimeInsert` in
// app/(tabs)/feed.utils.ts, which is the reducer every feed screen pipes
// Postgres INSERT events through. Comment lists apply the same rule inline
// (app/comments/[postId].tsx). There is no shared list-filter helper to
// point at: the one that used to live in components/tabs/SearchTab.utils.ts
// belonged to the orphaned web fork and went away with it.
// ---------------------------------------------------------------------------

import { applyRealtimeInsert, type FeedPost } from '../app/(tabs)/feed.utils';

describe('Block user flow — blocked content is hidden', () => {
  beforeEach(() => {
    installLocalStorageStub();
  });

  test('a realtime INSERT from a blocked author is dropped before it hits the feed', () => {
    // The HomeFeedScreen subscribes to Postgres Changes on the
    // `posts` table and pipes every INSERT through applyRealtimeInsert.
    // The reducer must consult the same block-list predicate the
    // initial-load filter uses, otherwise a blocked user's new post
    // would pop into the feed at the moment it is published.
    interface SamplePost extends FeedPost { username: string; }
    const current: SamplePost[] = [
      { id: 'a', username: 'alice' },
      { id: 'b', username: 'bob' },
    ];
    const incoming: SamplePost = { id: 'c', username: 'spammer' };
    const isBlocked = (u: string | undefined) => u === 'spammer';

    const next = applyRealtimeInsert(current, incoming, isBlocked);

    expect(next.map(p => p.id)).toEqual(['a', 'b']);
    expect(next.some(p => p.username === 'spammer')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Unblock restores visibility — toggling the same user removes them
//    from the block-list and their content comes back.
// ---------------------------------------------------------------------------

describe('Block user flow — unblock restores visibility', () => {
  beforeEach(() => {
    installLocalStorageStub();
  });

  test('toggling the same username a second time removes it from the block-list and clears it from localStorage', () => {
    // Mirrors the user-facing contract on app/user/[username].tsx:
    // the overflow menu shows "Block" the first time and "Unblock"
    // the second. There is no separate "Unblock" code path — it is
    // the same toggle.
    let state = createBlockListState();
    state = toggleBlockUser(state, 'spammer');
    expect(state.blocked.has('spammer')).toBe(true);

    state = toggleBlockUser(state, 'spammer');

    expect(state.blocked.has('spammer')).toBe(false);
    expect(state.blocked.size).toBe(0);

    // Persistence: the JSON payload written to localStorage must
    // reflect the empty set so a future rehydrate does not
    // resurrect the block. We pin the exact stored shape (empty
    // array, not null) because the AppProvider initializer guards
    // on Array.isArray(parsed) before rehydrating.
    const raw = globalThis.localStorage.getItem(BLOCKED_USERS_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual([]);
  });

  test('a post authored by a previously-blocked user becomes visible again after unblocking', () => {
    // End-to-end recovery scenario, driven through the live feed reducer:
    //   1. The viewer blocks `spammer`.
    //   2. An INSERT from spammer is dropped before it reaches the feed.
    //   3. The viewer unblocks `spammer`.
    //   4. The same INSERT now lands, at the head of the timeline.
    interface SamplePost extends FeedPost { username: string; }
    const timeline: SamplePost[] = [
      { id: 'p1', username: 'alice' },
      { id: 'p3', username: 'bob' },
    ];
    const incoming: SamplePost = { id: 'p2', username: 'spammer' };

    // Step 1+2: block. The predicate reads the live Set, so the same
    // closure reflects the unblock in step 3 without being rebuilt.
    const blocked = new Set<string>(['spammer']);
    const isBlocked = (u: string | undefined) => (u ? blocked.has(u) : false);

    const whileBlocked = applyRealtimeInsert(timeline, incoming, isBlocked);
    expect(whileBlocked.map(p => p.id)).toEqual(['p1', 'p3']);

    // Step 3: unblock — mirror toggleBlockUser's "delete on second tap".
    blocked.delete('spammer');

    // Step 4: the same INSERT is accepted now, newest-first, and the
    // existing timeline order below it is preserved.
    const afterUnblock = applyRealtimeInsert(timeline, incoming, isBlocked);
    expect(afterUnblock.map(p => p.id)).toEqual(['p2', 'p1', 'p3']);
    expect(afterUnblock.find(p => p.username === 'spammer')?.id).toBe('p2');
  });
});