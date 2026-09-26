//
// target: __tests__/features/notifications/notifications.test.ts
//
// The notifications domain (ONE-17), driven through a real QueryClient: the
// realtime cache writes, the optimistic mark-read cycles and the badge's
// `select`. Each block maps to an acceptance criterion on the ticket.

const mockMarkAll = jest.fn();
const mockMarkOne = jest.fn();

jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../../features/notifications/api', () => ({
  markNotificationsAsRead: (...args: unknown[]) => mockMarkAll(...args),
  markNotificationAsRead: (...args: unknown[]) => mockMarkOne(...args),
  fetchNotifications: jest.fn(),
  fetchNotificationById: jest.fn(),
}));

import { QueryClient, QueryObserver, MutationObserver } from '@tanstack/react-query';
import { notificationKeys } from '../../../features/notifications/keys';
import { unreadCount } from '../../../features/notifications/queries';
import {
  markAllReadOptions,
  markOneReadOptions,
} from '../../../features/notifications/mutations';
import {
  addNotificationToCache,
  applyNotificationUpdate,
} from '../../../features/notifications/realtime';
import type { Notification } from '../../../types';

// ─── Fixtures ───────────────────────────────────────────────────────────

const USER = 'u1';
const KEY = notificationKeys.forUser(USER);

const notification = (id: string, overrides: Partial<Notification> = {}): Notification => ({
  id,
  type: 'like',
  is_read: false,
  created_at: '2026-09-24T00:00:00.000Z',
  sender: { id: 's1', username: 'sender', avatar_url: null },
  post: null,
  ...overrides,
});

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const listOf = (client: QueryClient) => client.getQueryData<Notification[]>(KEY);

/** Run a mutation through a real observer, so the cycle fires as TanStack runs it. */
const run = async <TVariables>(client: QueryClient, options: object, variables: TVariables) => {
  const observer = new MutationObserver<unknown, Error, TVariables>(client, options as never);
  await observer.mutate(variables).catch(() => undefined);
};

beforeEach(() => {
  mockMarkAll.mockReset();
  mockMarkOne.mockReset();
});

// ─── 1. Realtime ────────────────────────────────────────────────────────

describe('realtime notifications', () => {
  it('puts a new notification at the top of the list', () => {
    const client = newClient();
    client.setQueryData(KEY, [notification('n1')]);

    addNotificationToCache(client, USER, notification('n2'));

    expect(listOf(client)!.map((n) => n.id)).toEqual(['n2', 'n1']);
  });

  it('shows one copy when the same notification arrives twice', () => {
    // The user's own action: the row is already in the cache by the time
    // the realtime INSERT for it lands.
    const client = newClient();
    client.setQueryData(KEY, [notification('n1')]);

    addNotificationToCache(client, USER, notification('n1'));
    addNotificationToCache(client, USER, notification('n1'));

    expect(listOf(client)!.map((n) => n.id)).toEqual(['n1']);
  });

  it('does not create the list before it has loaded', () => {
    // A one-row list here would be marked fresh and the real fetch skipped.
    const client = newClient();

    addNotificationToCache(client, USER, notification('n1'));
    applyNotificationUpdate(client, USER, { id: 'n1', is_read: true });

    expect(listOf(client)).toBeUndefined();
  });

  it('folds an update into the cached row', () => {
    const client = newClient();
    client.setQueryData(KEY, [notification('n1'), notification('n2')]);

    applyNotificationUpdate(client, USER, { id: 'n2', is_read: true });

    expect(listOf(client)!.map((n) => n.is_read)).toEqual([false, true]);
  });
});

// ─── 2. Mark all read ───────────────────────────────────────────────────

describe('mark all read', () => {
  it('clears every row and the badge before the server answers', async () => {
    const client = newClient();
    client.setQueryData(KEY, [notification('n1'), notification('n2')]);

    let resolve!: (ok: boolean) => void;
    mockMarkAll.mockReturnValue(new Promise<boolean>((r) => { resolve = r; }));

    const running = run(client, markAllReadOptions(client, USER), undefined);
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(unreadCount(listOf(client))).toBe(0);

    resolve(true);
    await running;
  });

  it('puts the rows and the badge back when the server refuses', async () => {
    const client = newClient();
    const before = [notification('n1'), notification('n2', { is_read: true })];
    client.setQueryData(KEY, before);
    mockMarkAll.mockResolvedValue(false);

    await run(client, markAllReadOptions(client, USER), undefined);

    expect(listOf(client)).toEqual(before);
    expect(unreadCount(listOf(client))).toBe(1);
  });

  it('does not blank the screen when it runs before the list has loaded', async () => {
    // The screen marks everything read as it opens.
    const client = newClient();
    mockMarkAll.mockResolvedValue(true);

    await run(client, markAllReadOptions(client, USER), undefined);

    expect(listOf(client)).toBeUndefined();
  });
});

// ─── 3. Mark one read ───────────────────────────────────────────────────

describe('mark one read', () => {
  it('flips only that row, and restores it on failure', async () => {
    const client = newClient();
    client.setQueryData(KEY, [notification('n1'), notification('n2')]);

    let resolveCheck!: () => void;
    const checked = new Promise<void>((r) => { resolveCheck = r; });
    mockMarkOne.mockImplementation(async () => {
      expect(listOf(client)!.map((n) => n.is_read)).toEqual([false, true]);
      resolveCheck();
      throw new Error('refused');
    });

    await run(client, markOneReadOptions(client, USER), 'n2');
    await checked;

    expect(listOf(client)!.map((n) => n.is_read)).toEqual([false, false]);
  });
});

// ─── 4. The badge's select ──────────────────────────────────────────────

describe('unread badge', () => {
  it('re-renders only when the unread count changes', async () => {
    // What useUnreadNotificationCount builds: the list's key, narrowed by
    // `select` to a count. The hook reads only `data`, which is what React
    // Query's tracked props reduce notifyOnChangeProps to.
    const client = newClient();
    client.setQueryData(KEY, [notification('n1'), notification('n2')]);

    const observer = new QueryObserver<Notification[], Error, number>(client, {
      queryKey: KEY,
      queryFn: async () => listOf(client)!,
      enabled: false,
      select: unreadCount,
      notifyOnChangeProps: ['data'],
    });
    const listener = jest.fn();
    const unsubscribe = observer.subscribe(listener);
    expect(observer.getCurrentResult().data).toBe(2);

    // An unrelated field changes — a sender's avatar arriving.
    client.setQueryData<Notification[]>(KEY, (list) =>
      list!.map((n) => ({ ...n, sender: { ...n.sender, avatar_url: 'https://a/b.png' } })),
    );
    expect(listener).not.toHaveBeenCalled();

    // The count changes.
    client.setQueryData<Notification[]>(KEY, (list) =>
      list!.map((n) => (n.id === 'n1' ? { ...n, is_read: true } : n)),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().data).toBe(1);

    unsubscribe();
  });
});
