//
// target: __tests__/features/messages/api.test.ts
//
// Reading a conversation a page at a time, and the Messages list, against a
// stand-in for the API (ONE-110). The API returns at most 1,000 rows to a
// request, so nothing here may depend on one read returning everything.

const mockRpc = jest.fn();
jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: jest.fn(), rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import { fetchOlderMessages, fetchThread, getChatListUsers, THREAD_PAGE_SIZE } from '../../../features/messages/api';

const ME = 'me';
const THEM = 'them';

interface Row {
  id: string;
  sender_id: string;
  receiver_id: string;
  text: string;
  created_at: string;
}

/** A 5,000-message conversation, oldest first; every tenth shares its second with the one before. */
const conversation: Row[] = Array.from({ length: 5000 }, (_, i) => ({
  id: `m${String(i).padStart(5, '0')}`,
  sender_id: i % 2 ? ME : THEM,
  receiver_id: i % 2 ? THEM : ME,
  text: `message ${i}`,
  created_at: new Date(Date.UTC(2026, 0, 1) + (i - (i % 10 === 9 ? 1 : 0)) * 1000).toISOString(),
}));

/** What messages_thread returns: newest first, before the cursor, at most 200. */
const messagesThread = (args: { p_before: string | null; p_before_id: string | null; p_limit: number }) => {
  const before = (row: Row) =>
    args.p_before === null ||
    row.created_at < args.p_before ||
    (row.created_at === args.p_before && args.p_before_id !== null && row.id < args.p_before_id);
  return [...conversation]
    .reverse()
    .filter(before)
    .slice(0, Math.min(Math.max(args.p_limit, 1), 200));
};

/** An rpc builder that chains and awaits to `result`, recording its calls. */
const chainOf = (result: unknown) => {
  const calls: Record<string, unknown[][]> = {};
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'order']) {
    chain[method] = (...args: unknown[]) => {
      (calls[method] ??= []).push(args);
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return { chain, calls };
};

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockImplementation((fn: string, args: never) =>
    chainOf({ data: fn === 'messages_thread' ? messagesThread(args) : [], error: null }).chain,
  );
});

describe('opening a thread', () => {
  it('opens a 5,000-message thread on its newest page, oldest first on screen', async () => {
    const thread = await fetchThread(ME, THEM);

    expect(thread).toHaveLength(THREAD_PAGE_SIZE);
    expect(thread[thread.length - 1].id).toBe('m04999');
    expect(thread[0].id).toBe('m04900');
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('messages_thread', {
      p_profile: ME,
      p_other: THEM,
      p_before: null,
      p_before_id: null,
      p_limit: THREAD_PAGE_SIZE,
    });
  });

  it('asks the API for newest first, ties broken by id', async () => {
    const read = chainOf({ data: [], error: null });
    mockRpc.mockReturnValue(read.chain);

    await fetchThread(ME, THEM);

    expect(read.calls.order).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
  });

  it('refetches deeper threads in requests of at most 200, each from the last one\'s oldest', async () => {
    const thread = await fetchThread(ME, THEM, 450);

    expect(thread.map((m) => m.id)).toEqual(conversation.slice(-450).map((m) => m.id));
    expect(mockRpc.mock.calls.map(([, args]) => (args as { p_limit: number }).p_limit)).toEqual([200, 200, 50]);
    const second = mockRpc.mock.calls[1][1] as { p_before: string; p_before_id: string };
    expect(second.p_before_id).toBe('m04800');
  });

  it('stops at the first message', async () => {
    const thread = await fetchThread(ME, THEM, 6000);
    expect(thread).toHaveLength(5000);
    expect(thread[0].id).toBe('m00000');
  });

  it('throws what the API refused with', async () => {
    mockRpc.mockReturnValue(chainOf({ data: null, error: { message: 'refused' } }).chain);
    await expect(fetchThread(ME, THEM)).rejects.toEqual({ message: 'refused' });
  });
});

describe('scrolling back', () => {
  it('scrolls back from the newest page to the first message, every message once', async () => {
    let thread = await fetchThread(ME, THEM);
    for (let pages = 0; pages < 100; pages++) {
      const older = await fetchOlderMessages(ME, THEM, thread[0]);
      if (older.length === 0) break;
      thread = [...older, ...thread];
    }

    expect(thread).toHaveLength(5000);
    expect(new Set(thread.map((m) => m.id)).size).toBe(5000);
    expect(thread.map((m) => m.id)).toEqual(conversation.map((m) => m.id));
  });
});

describe('the Messages list', () => {
  it('comes from chat_list, latest conversation first, as a list of people', async () => {
    const read = chainOf({
      data: [
        {
          id: 'p-new', full_name: 'New', username: 'new', avatar_url: null, is_verified: false,
          last_message_at: '2026-09-28T10:00:00Z', last_message_text: 'see you then', last_message_type: 'text', last_message_sender_id: ME,
        },
        {
          id: 'p-old', full_name: 'Old', username: 'old', avatar_url: 'a.jpg', is_verified: true,
          last_message_at: '2025-01-01T10:00:00Z', last_message_text: null, last_message_type: 'post_share', last_message_sender_id: 'p-old',
        },
      ],
      error: null,
    });
    mockRpc.mockReturnValue(read.chain);

    const list = await getChatListUsers(ME);

    expect(mockRpc).toHaveBeenCalledWith('chat_list', { p_profile: ME });
    expect(read.calls.order).toEqual([['last_message_at', { ascending: false }]]);
    expect(list).toEqual([
      {
        id: 'p-new', name: 'New', username: 'new', avatar: null, isVerified: false,
        lastMessage: { text: 'see you then', type: 'text', senderId: ME, sentAt: '2026-09-28T10:00:00Z' },
      },
      {
        id: 'p-old', name: 'Old', username: 'old', avatar: 'a.jpg', isVerified: true,
        lastMessage: { text: null, type: 'post_share', senderId: 'p-old', sentAt: '2025-01-01T10:00:00Z' },
      },
    ]);
  });
});
