//
// target: __tests__/lib/optimisticToggle.test.ts
//
// The shared optimistic toggle (ONE-13). Like, Repost, Save and — later —
// Follow all run through this, so a rollback bug here is a rollback bug in
// every one of them at once. That is the reason the helper exists, and the
// reason this suite goes after the failure paths harder than the happy one.
//
// The mutation cycle is driven through a real QueryClient rather than a
// mounted component: `toggleMutationOptions` is the same object the hook
// hands to `useMutation`, so what is exercised here is what ships.

import { QueryClient, MutationObserver } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import {
  toggleMutationOptions,
  toggled,
  patchLists,
  type OptimisticToggleConfig,
} from '../../lib/optimisticToggle';

// ─── Fixtures ───────────────────────────────────────────────────────────

interface Item {
  id: string;
  isOn: boolean;
  count: number;
  label: string;
}

const item = (overrides: Partial<Item> = {}): Item => ({
  id: 'p1',
  isOn: false,
  count: 3,
  label: 'untouched',
  ...overrides,
});

const detailKey = (id: string) => ['items', 'detail', id];
const LIST_PREFIX = ['items'];
const feedKey = ['items', 'feed', 'u1'];

const pages = (...pageArrays: Item[][]): InfiniteData<Item[], null> => ({
  pages: pageArrays,
  pageParams: pageArrays.map(() => null),
});

const config = (
  overrides: Partial<OptimisticToggleConfig<Item>> = {},
): OptimisticToggleConfig<Item> => ({
  mutationFn: async () => undefined,
  entityKey: detailKey,
  listKey: LIST_PREFIX,
  isOn: (i) => i.isOn,
  count: (i) => i.count,
  apply: (i, next) => ({ ...i, isOn: next.isOn, count: next.count }),
  entityId: (i) => i.id,
  ...overrides,
});

/**
 * Run one toggle to completion through a real mutation observer, so onMutate,
 * onError and onSettled fire in the order and with the arguments TanStack
 * actually uses.
 */
const runToggle = async (
  client: QueryClient,
  cfg: OptimisticToggleConfig<Item>,
  id = 'p1',
): Promise<void> => {
  const observer = new MutationObserver<unknown, Error, string>(
    client,
    toggleMutationOptions(client, cfg) as never,
  );
  await observer.mutate(id).catch(() => undefined);
};

/** Let every already-queued promise settle without advancing timers. */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

// ─── 1. The pure transforms ─────────────────────────────────────────────

describe('toggled', () => {
  it('turns on and moves the count up', () => {
    expect(toggled(item({ isOn: false, count: 3 }), config())).toMatchObject({ isOn: true, count: 4 });
  });

  it('turns off and moves the count down', () => {
    expect(toggled(item({ isOn: true, count: 3 }), config())).toMatchObject({ isOn: false, count: 2 });
  });

  it('never drives a count below zero', () => {
    // Only reachable from a cache that was already wrong, but "-1 likes" is
    // a worse way to find that out than a floor.
    expect(toggled(item({ isOn: true, count: 0 }), config()).count).toBe(0);
  });

  it('leaves the rest of the entity alone', () => {
    expect(toggled(item({ label: 'keep me' }), config()).label).toBe('keep me');
  });

  it('does not mutate the entity it was given', () => {
    const original = item({ isOn: false, count: 3 });
    toggled(original, config());
    expect(original).toEqual({ id: 'p1', isOn: false, count: 3, label: 'untouched' });
  });
});

describe('patchLists', () => {
  const bump = (i: Item): Item => ({ ...i, count: i.count + 1 });

  it('patches the entity on whichever page holds it', () => {
    const data = pages([item({ id: 'a' })], [item({ id: 'p1' }), item({ id: 'b' })]);
    const next = patchLists<Item>(data, 'p1', (i) => i.id, bump) as typeof data;

    expect(next.pages[1]![0]!.count).toBe(4);
    expect(next.pages[1]![1]!.count).toBe(3);
  });

  it('returns the same reference when the entity is not in this list', () => {
    const data = pages([item({ id: 'a' })]);
    expect(patchLists<Item>(data, 'p1', (i) => i.id, bump)).toBe(data);
  });

  it('ignores cached data that is not a list', () => {
    const detail = item();
    expect(patchLists<Item>(detail, 'p1', (i) => i.id, bump)).toBe(detail);
    expect(patchLists<Item>(undefined, 'p1', (i) => i.id, bump)).toBeUndefined();
  });
});

// ─── 2. The optimistic write ────────────────────────────────────────────

describe('optimistic toggle — the happy path', () => {
  it('applies the new value before the server call resolves', async () => {
    const client = newClient();
    client.setQueryData(detailKey('p1'), item({ isOn: false, count: 3 }));

    let resolve!: () => void;
    const pending = new Promise<void>((r) => { resolve = r; });

    const running = runToggle(client, config({ mutationFn: () => pending }));

    // Let onMutate finish — it awaits two cancelQueries before writing — but
    // leave the server call hanging.
    await flushMicrotasks();
    expect(client.getQueryData<Item>(detailKey('p1'))).toMatchObject({ isOn: true, count: 4 });

    resolve();
    await running;
  });

  it('updates the list copy and the detail copy from one toggle', async () => {
    const client = newClient();
    client.setQueryData(detailKey('p1'), item({ isOn: false, count: 3 }));
    client.setQueryData(feedKey, pages([item({ id: 'p1', isOn: false, count: 3 })]));

    await runToggle(client, config());

    expect(client.getQueryData<Item>(detailKey('p1'))).toMatchObject({ isOn: true, count: 4 });
    const feed = client.getQueryData<InfiniteData<Item[], null>>(feedKey)!;
    expect(feed.pages[0]![0]).toMatchObject({ isOn: true, count: 4 });
  });

  it('fires the haptic callback the moment the cache flips', async () => {
    const client = newClient();
    client.setQueryData(detailKey('p1'), item({ isOn: false }));
    const onToggle = jest.fn();

    await runToggle(client, config({ onToggle }));

    expect(onToggle).toHaveBeenCalledWith({ isOn: true });
  });

  it('reports "off" for an entity that lives only in a list page', async () => {
    // The feed case: no detail entry, just the copy inside the pages. This
    // used to be reported as "on" regardless, so unsaving said "Saved".
    const client = newClient();
    client.setQueryData(feedKey, pages([item({ isOn: true })]));
    const onToggle = jest.fn();

    await runToggle(client, config({ onToggle }));

    expect(onToggle).toHaveBeenCalledWith({ isOn: false });
  });
});

// ─── 3. Rollback — the reason this file exists ──────────────────────────

describe('optimistic toggle — rollback', () => {
  const rejecting = () => config({ mutationFn: async () => { throw new Error('server said no'); } });

  it('restores both the boolean and the count on the detail entry', async () => {
    const client = newClient();
    client.setQueryData(detailKey('p1'), item({ isOn: false, count: 3 }));

    await runToggle(client, rejecting());

    expect(client.getQueryData<Item>(detailKey('p1'))).toMatchObject({ isOn: false, count: 3 });
  });

  it('restores the copy inside an infinite-query page, not just the detail', async () => {
    // The bug this centralization exists to prevent: a failed like leaving a
    // stale count behind in the feed it was tapped from.
    const client = newClient();
    client.setQueryData(detailKey('p1'), item({ isOn: false, count: 3 }));
    client.setQueryData(feedKey, pages([item({ id: 'other' })], [item({ id: 'p1', isOn: false, count: 3 })]));

    await runToggle(client, rejecting());

    const feed = client.getQueryData<InfiniteData<Item[], null>>(feedKey)!;
    expect(feed.pages[1]![0]).toMatchObject({ isOn: false, count: 3 });
    expect(feed.pages[0]![0]).toMatchObject({ id: 'other', count: 3 });
  });

  it('restores an entity that was on, not just one that was off', async () => {
    const client = newClient();
    client.setQueryData(detailKey('p1'), item({ isOn: true, count: 9 }));

    await runToggle(client, rejecting());

    expect(client.getQueryData<Item>(detailKey('p1'))).toMatchObject({ isOn: true, count: 9 });
  });

  it('leaves every other cached entity untouched', async () => {
    const client = newClient();
    client.setQueryData(detailKey('p1'), item({ isOn: false, count: 3 }));
    client.setQueryData(detailKey('p2'), item({ id: 'p2', isOn: true, count: 7 }));

    await runToggle(client, rejecting());

    expect(client.getQueryData<Item>(detailKey('p2'))).toMatchObject({ isOn: true, count: 7 });
  });

  it('rolls back when the caller cannot even make the call', async () => {
    // useLikePost throws from mutationFn when signed out; that must route
    // through the same rollback as a server refusal.
    const client = newClient();
    client.setQueryData(detailKey('p1'), item({ isOn: false, count: 3 }));

    await runToggle(client, config({
      mutationFn: () => { throw new Error('You must be signed in to do that.'); },
    }));

    expect(client.getQueryData<Item>(detailKey('p1'))).toMatchObject({ isOn: false, count: 3 });
  });
});

// ─── 4. Repeated taps ───────────────────────────────────────────────────

describe('optimistic toggle — two taps', () => {
  it('settles back to where it started after on then off', async () => {
    const client = newClient();
    client.setQueryData(detailKey('p1'), item({ isOn: false, count: 3 }));
    client.setQueryData(feedKey, pages([item({ id: 'p1', isOn: false, count: 3 })]));

    const cfg = config();
    await runToggle(client, cfg);
    await runToggle(client, cfg);

    expect(client.getQueryData<Item>(detailKey('p1'))).toMatchObject({ isOn: false, count: 3 });
    const feed = client.getQueryData<InfiniteData<Item[], null>>(feedKey)!;
    expect(feed.pages[0]![0]).toMatchObject({ isOn: false, count: 3 });
  });

  it('reads each toggle off the cache, so two rapid taps do not both turn it on', async () => {
    const client = newClient();
    client.setQueryData(detailKey('p1'), item({ isOn: false, count: 3 }));

    const calls: string[] = [];
    const cfg = config({
      mutationFn: async () => { calls.push('server'); },
    });

    await Promise.all([runToggle(client, cfg), runToggle(client, cfg)]);

    // Two taps, two server calls, and a cache that ends where it began —
    // never "on twice" with a count of 5.
    expect(calls).toHaveLength(2);
    expect(client.getQueryData<Item>(detailKey('p1'))).toMatchObject({ isOn: false, count: 3 });
  });

  it('a failed second tap leaves the successful first one in place', async () => {
    const client = newClient();
    client.setQueryData(detailKey('p1'), item({ isOn: false, count: 3 }));

    await runToggle(client, config());
    await runToggle(client, config({
      mutationFn: async () => { throw new Error('server said no'); },
    }));

    expect(client.getQueryData<Item>(detailKey('p1'))).toMatchObject({ isOn: true, count: 4 });
  });
});
