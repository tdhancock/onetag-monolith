//
// target: __tests__/features/blocks/blocks.test.ts
//
// The client half of ONE-54: the block list as a query, the toggle that runs
// on the shared optimistic helper, and the one-time import of the device-local
// list out of AsyncStorage.
//
// Two things here are safety properties rather than conveniences:
//
//   1. The AsyncStorage key is cleared *only* after its contents reach the
//      database. A user who blocked someone last week must not silently
//      un-block them by updating the app.
//   2. A failed block rolls the list back. A UI that says "blocked" when the
//      server refused is worse than one that says nothing.

// localMigration pulls in the api module, which builds the Supabase client at
// import time; this suite never reaches the network through it.
jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: jest.fn() },
}));

import { QueryClient, MutationObserver } from '@tanstack/react-query';
import { toggleMutationOptions } from '../../../lib/optimisticToggle';
import type { BlockedUser } from '../../../features/blocks/types';
import { migrateLocalBlocks, LOCAL_BLOCKS_KEY } from '../../../features/blocks/localMigration';
import { shouldBlockAfterFlip } from '../../../features/blocks/mutations';
import { asAuthUserId } from '../../../types';

// ─── Fixtures ───────────────────────────────────────────────────────────

const LIST_KEY = ['blocks', 'list', 'me'];

const blocked = (userId: string, username: string): BlockedUser => ({
  userId,
  username,
  usernames: [username],
  name: null,
  avatarUrl: null,
  blockedAt: '2026-09-23T00:00:00.000Z',
});

/**
 * The same configuration `useBlockToggle` builds, without the hook around it:
 * the cached *list* is the entity, `isOn` is membership, and `apply` adds or
 * removes the row.
 */
const blockToggleConfig = (
  client: QueryClient,
  mutationFn: (id: string) => Promise<unknown>,
) => ({
  mutationFn,
  entityKey: () => LIST_KEY,
  listKey: ['blocks'],
  entityId: () => '',
  isOn: (list: BlockedUser[], userId: string) => list.some((u) => u.userId === userId),
  count: (list: BlockedUser[]) => list.length,
  apply: (list: BlockedUser[], next: { isOn: boolean }, userId: string) =>
    next.isOn ? [blocked(userId, 'pending'), ...list] : list.filter((u) => u.userId !== userId),
});

const runToggle = async (
  client: QueryClient,
  mutationFn: (id: string) => Promise<unknown>,
  userId: string,
): Promise<void> => {
  const observer = new MutationObserver<unknown, Error, string>(
    client,
    toggleMutationOptions(client, blockToggleConfig(client, mutationFn)) as never,
  );
  await observer.mutate(userId).catch(() => undefined);
};

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

// ─── 1. The optimistic toggle ───────────────────────────────────────────

describe('block toggle', () => {
  it('adds the account to the list before the server answers', async () => {
    const client = newClient();
    client.setQueryData(LIST_KEY, []);

    let resolve!: () => void;
    const pending = new Promise<void>((r) => { resolve = r; });

    const running = runToggle(client, () => pending, 'u1');
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(client.getQueryData<BlockedUser[]>(LIST_KEY)).toHaveLength(1);

    resolve();
    await running;
  });

  it('removes the account when unblocking', async () => {
    const client = newClient();
    client.setQueryData(LIST_KEY, [blocked('u1', 'spammer'), blocked('u2', 'other')]);

    await runToggle(client, async () => undefined, 'u1');

    const list = client.getQueryData<BlockedUser[]>(LIST_KEY)!;
    expect(list.map((u) => u.userId)).toEqual(['u2']);
  });

  it('restores the list when the block is refused', async () => {
    const client = newClient();
    client.setQueryData(LIST_KEY, []);

    await runToggle(client, async () => { throw new Error('refused'); }, 'u1');

    expect(client.getQueryData<BlockedUser[]>(LIST_KEY)).toEqual([]);
  });

  it('puts an unblocked account back when the unblock is refused', async () => {
    // The dangerous direction: a UI that shows someone as unblocked while the
    // block is still in force is merely confusing, but the reverse — showing
    // them as blocked when they are not — is a safety claim that is false.
    const client = newClient();
    client.setQueryData(LIST_KEY, [blocked('u1', 'spammer')]);

    await runToggle(client, async () => { throw new Error('refused'); }, 'u1');

    expect(client.getQueryData<BlockedUser[]>(LIST_KEY)).toEqual([blocked('u1', 'spammer')]);
  });

  it('asks the server for whatever the cache now says', async () => {
    // `mutationFn` reads the post-flip cache rather than keeping its own
    // record of intent, so the two can never disagree.
    const client = newClient();
    client.setQueryData(LIST_KEY, []);
    const calls: string[] = [];

    const mutationFn = async (userId: string) => {
      const shouldBlock = shouldBlockAfterFlip(client.getQueryData<BlockedUser[]>(LIST_KEY), userId);
      calls.push(shouldBlock ? 'block' : 'unblock');
    };

    await runToggle(client, mutationFn, 'u1');
    await runToggle(client, mutationFn, 'u1');

    expect(calls).toEqual(['block', 'unblock']);
  });

  it('blocks, rather than silently unblocking, when the list has not loaded', async () => {
    // Nothing cached yet — the block list is still loading, or onMutate has
    // just cancelled its fetch — so there is nothing for the flip to act on.
    const client = newClient();
    const calls: string[] = [];

    const mutationFn = async (userId: string) => {
      const shouldBlock = shouldBlockAfterFlip(client.getQueryData<BlockedUser[]>(LIST_KEY), userId);
      calls.push(shouldBlock ? 'block' : 'unblock');
    };

    await runToggle(client, mutationFn, 'u1');

    expect(calls).toEqual(['block']);
  });
});

// ─── 2. The one-time AsyncStorage import ────────────────────────────────
//
// The real `migrateLocalBlocks`, with a fake store standing in for
// AsyncStorage — the provider calls this same function with the real one.

describe('migrating the device-local block list', () => {
  /** A fake AsyncStorage: the provider passes the real one. */
  const fakeStore = (initial: Record<string, string>) => {
    const values: Record<string, string> = { ...initial };

    return {
      values,
      getItem: async (key: string) => values[key] ?? null,
      removeItem: async (key: string) => { delete values[key]; },
    };
  };

  it('imports the stored usernames and clears the key', async () => {
    const store = fakeStore({ [LOCAL_BLOCKS_KEY]: JSON.stringify(['spammer', 'troll']) });
    const importBlocks = jest.fn(async () => 2);

    await expect(migrateLocalBlocks(store, asAuthUserId('me'), importBlocks)).resolves.toBe(2);

    expect(importBlocks).toHaveBeenCalledWith('me', ['spammer', 'troll']);
    expect(store.values[LOCAL_BLOCKS_KEY]).toBeUndefined();
  });

  it('keeps the key when the import fails, so the next launch retries', async () => {
    // Clearing first would lose the block permanently — the user would be
    // silently un-blocked by updating the app.
    const store = fakeStore({ [LOCAL_BLOCKS_KEY]: JSON.stringify(['spammer']) });
    const importBlocks = jest.fn(async () => { throw new Error('offline'); });

    await migrateLocalBlocks(store, asAuthUserId('me'), importBlocks);

    expect(store.values[LOCAL_BLOCKS_KEY]).toBe(JSON.stringify(['spammer']));
  });

  it('runs once: a cleared key means nothing to import next time', async () => {
    const store = fakeStore({ [LOCAL_BLOCKS_KEY]: JSON.stringify(['spammer']) });
    const importBlocks = jest.fn(async () => 1);

    await migrateLocalBlocks(store, asAuthUserId('me'), importBlocks);
    await expect(migrateLocalBlocks(store, asAuthUserId('me'), importBlocks)).resolves.toBeNull();

    expect(importBlocks).toHaveBeenCalledTimes(1);
  });

  it('clears an empty list without calling the server', async () => {
    const store = fakeStore({ [LOCAL_BLOCKS_KEY]: JSON.stringify([]) });
    const importBlocks = jest.fn(async () => 0);

    await migrateLocalBlocks(store, asAuthUserId('me'), importBlocks);

    expect(importBlocks).not.toHaveBeenCalled();
    expect(store.values[LOCAL_BLOCKS_KEY]).toBeUndefined();
  });

  it('survives a corrupt payload rather than throwing on boot', async () => {
    const store = fakeStore({ [LOCAL_BLOCKS_KEY]: '{not json' });
    const importBlocks = jest.fn(async () => 0);

    await expect(migrateLocalBlocks(store, asAuthUserId('me'), importBlocks)).resolves.toBeNull();
    expect(importBlocks).not.toHaveBeenCalled();
  });

  it('ignores non-string entries in the stored array', async () => {
    const store = fakeStore({ [LOCAL_BLOCKS_KEY]: JSON.stringify(['spammer', 42, null]) });
    const importBlocks = jest.fn(async () => 1);

    await migrateLocalBlocks(store, asAuthUserId('me'), importBlocks);

    expect(importBlocks).toHaveBeenCalledWith('me', ['spammer']);
  });
});
