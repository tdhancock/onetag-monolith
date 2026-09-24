//
// target: __tests__/features/messages/messages.test.ts
//
// The direct messages domain (ONE-18), driven through a real QueryClient: the
// optimistic send and its three-path reconciliation, read state behind the
// badge, deletion, and the realtime cache writes. Each block maps to an
// acceptance criterion on the ticket.

const mockSendMessage = jest.fn();
const mockMarkChat = jest.fn();
const mockMarkAll = jest.fn();
const mockDeleteConversation = jest.fn();
const mockFetchMessageById = jest.fn();

jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: jest.fn() },
}), { virtual: true });

jest.mock('../../../features/messages/api', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  markMessagesAsRead: (...args: unknown[]) => mockMarkChat(...args),
  markAllMessagesAsRead: (...args: unknown[]) => mockMarkAll(...args),
  deleteConversationForBothSides: (...args: unknown[]) => mockDeleteConversation(...args),
  fetchMessageById: (...args: unknown[]) => mockFetchMessageById(...args),
  hydrateMessageRow: (row: object) => ({
    sharedPost: null,
    sharedUser: null,
    repliedStory: null,
    repliedMessage: null,
    ...row,
  }),
  fetchThread: jest.fn(),
  fetchUnreadSenderIds: jest.fn(),
  getChatListUsers: jest.fn(),
}));

import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { messageKeys } from '../../../features/messages/keys';
import {
  deleteConversationOptions,
  markAllMessagesReadOptions,
  markChatReadOptions,
  sendMessageOptions,
} from '../../../features/messages/mutations';
import { appendToThread, isPendingMessage, reconcileSentMessage } from '../../../features/messages/cache';
import { applyIncomingMessage } from '../../../features/messages/realtime';
import { unreadMessageCountOf } from '../../../features/messages/queries';
import { isPersistable } from '../../../lib/queryClient';
import type { Message, Post, SimpleUser } from '../../../types';

// ─── Fixtures ───────────────────────────────────────────────────────────

const ME = 'me';
const THEM = 'them';
const THREAD = messageKeys.thread(ME, THEM);
const UNREAD = messageKeys.unread(ME);
const CONVERSATIONS = messageKeys.conversations(ME);

const message = (id: string, overrides: Partial<Message> = {}): Message => ({
  id,
  sender_id: THEM,
  receiver_id: ME,
  text: `text ${id}`,
  created_at: '2026-09-24T10:00:00.000Z',
  type: 'text',
  ...overrides,
});

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const threadOf = (client: QueryClient) => client.getQueryData<Message[]>(THREAD);
const idsOf = (client: QueryClient) => threadOf(client)!.map((m) => m.id);

/** Run a mutation through a real observer, so the cycle fires as TanStack runs it. */
const run = async <TVariables>(client: QueryClient, options: object, variables: TVariables) => {
  const observer = new MutationObserver<unknown, Error, TVariables>(client, options as never);
  await observer.mutate(variables).catch(() => undefined);
};

/** Resolve a promise the test controls, to stage the order paths arrive in. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mockSendMessage.mockReset();
  mockMarkChat.mockReset();
  mockMarkAll.mockReset();
  mockDeleteConversation.mockReset();
  mockFetchMessageById.mockReset();
});

// ─── 1. Sending ─────────────────────────────────────────────────────────

describe('sending a message', () => {
  it('appears immediately with a pending id, then settles in the same position', async () => {
    const client = newClient();
    client.setQueryData(THREAD, [message('m1')]);

    const server = deferred<Message>();
    mockSendMessage.mockReturnValue(server.promise);

    const observer = new MutationObserver(client, sendMessageOptions(client, ME) as never);
    const sending = observer.mutate({ receiverId: THEM, text: 'hello' } as never);
    await flush();

    // Pending: at the bottom, with a temporary id.
    const pending = threadOf(client)!;
    expect(pending).toHaveLength(2);
    expect(isPendingMessage(pending[1])).toBe(true);
    expect(pending[1].text).toBe('hello');

    // Another message arrives before the send settles.
    client.setQueryData<Message[]>(THREAD, (thread) => appendToThread(thread!, message('m2')));

    // The server's clock disagrees with the client's by a few seconds.
    server.resolve(message('server-1', { sender_id: ME, receiver_id: THEM, text: 'hello', created_at: '2026-09-24T09:59:55.000Z' }));
    await sending;

    expect(idsOf(client)).toEqual(['m1', 'server-1', 'm2']);
  });

  it('leaves exactly one copy when the realtime echo lands before the response', async () => {
    const client = newClient();
    client.setQueryData(THREAD, [message('m1')]);

    const server = deferred<Message>();
    mockSendMessage.mockReturnValue(server.promise);

    const observer = new MutationObserver(client, sendMessageOptions(client, ME) as never);
    const sending = observer.mutate({ receiverId: THEM, text: 'hi' } as never);
    await flush();

    const row = message('server-2', { sender_id: ME, receiver_id: THEM, text: 'hi' });
    // Echo first...
    client.setQueryData<Message[]>(THREAD, (thread) => appendToThread(thread!, row));
    // ...then the response.
    server.resolve(row);
    await sending;

    expect(idsOf(client)).toEqual(['m1', 'server-2']);
  });

  it('leaves exactly one copy when the realtime echo lands after the response', async () => {
    const client = newClient();
    client.setQueryData(THREAD, [message('m1')]);

    const row = message('server-3', { sender_id: ME, receiver_id: THEM, text: 'yo' });
    mockSendMessage.mockResolvedValue(row);

    await run(client, sendMessageOptions(client, ME), { receiverId: THEM, text: 'yo' });
    client.setQueryData<Message[]>(THREAD, (thread) => appendToThread(thread!, row));

    expect(idsOf(client)).toEqual(['m1', 'server-3']);
  });

  it('removes the optimistic message when the send fails', async () => {
    const client = newClient();
    client.setQueryData(THREAD, [message('m1')]);
    mockSendMessage.mockRejectedValue(new Error('offline'));

    await run(client, sendMessageOptions(client, ME), { receiverId: THEM, text: 'lost' });

    expect(idsOf(client)).toEqual(['m1']);
  });

  it('does not create a thread that has not loaded', async () => {
    const client = newClient();
    mockSendMessage.mockResolvedValue(message('server-4', { sender_id: ME, receiver_id: THEM }));

    await run(client, sendMessageOptions(client, ME), { receiverId: THEM, text: 'first' });

    expect(threadOf(client)).toBeUndefined();
  });

  it('keeps the shared post preview on the settled row', async () => {
    const client = newClient();
    client.setQueryData(THREAD, []);
    const post = { id: 'p1', username: 'author' } as Post;
    mockSendMessage.mockResolvedValue(
      message('server-5', { sender_id: ME, receiver_id: THEM, type: 'post_share', shared_post_id: 'p1' }),
    );

    await run(client, sendMessageOptions(client, ME), { receiverId: THEM, post });

    expect(threadOf(client)![0].sharedPost).toBe(post);
  });

  it('refreshes the conversation list once the send settles', async () => {
    const client = newClient();
    client.setQueryData(CONVERSATIONS, []);
    mockSendMessage.mockResolvedValue(message('server-6', { sender_id: ME, receiver_id: THEM }));

    await run(client, sendMessageOptions(client, ME), { receiverId: THEM, text: 'x' });

    expect(client.getQueryState(CONVERSATIONS)?.isInvalidated).toBe(true);
  });
});

describe('reconcileSentMessage', () => {
  it('falls back to a once-only append when the optimistic row is gone', () => {
    const row = message('s1');
    expect(reconcileSentMessage([message('m1')], 'temp-message-x', row).map((m) => m.id)).toEqual(['m1', 's1']);
    expect(reconcileSentMessage([message('m1'), row], 'temp-message-x', row).map((m) => m.id)).toEqual(['m1', 's1']);
  });
});

// ─── 2. Read state and the badge ────────────────────────────────────────

describe('read state', () => {
  it('drops the badge the moment a conversation is opened', async () => {
    const client = newClient();
    client.setQueryData(UNREAD, [THEM, 'other']);
    const server = deferred<boolean>();
    mockMarkChat.mockReturnValue(server.promise);

    const observer = new MutationObserver(client, markChatReadOptions(client, ME) as never);
    const marking = observer.mutate(THEM as never);
    await flush();

    expect(unreadMessageCountOf(client.getQueryData(UNREAD))).toBe(1);

    server.resolve(true);
    await marking;
    expect(mockMarkChat).toHaveBeenCalledWith(ME, THEM);
  });

  it('restores the badge when marking read fails', async () => {
    const client = newClient();
    client.setQueryData(UNREAD, [THEM]);
    mockMarkChat.mockResolvedValue(false);

    await run(client, markChatReadOptions(client, ME), THEM);

    expect(client.getQueryData(UNREAD)).toEqual([THEM]);
  });

  it('clears everything when the inbox opens', async () => {
    const client = newClient();
    client.setQueryData(UNREAD, [THEM, 'other']);
    mockMarkAll.mockResolvedValue(true);

    await run(client, markAllMessagesReadOptions(client, ME), undefined);

    expect(client.getQueryData(UNREAD)).toEqual([]);
  });

  it('counts conversations, not messages', () => {
    expect(unreadMessageCountOf(undefined)).toBe(0);
    expect(unreadMessageCountOf(['a', 'b', 'c'])).toBe(3);
  });
});

// ─── 3. Deleting ────────────────────────────────────────────────────────

describe('deleting a conversation', () => {
  const user = (id: string): SimpleUser => ({ id, name: id, username: id, avatar: null });

  it('removes it from the list and drops the cached thread', async () => {
    const client = newClient();
    client.setQueryData(CONVERSATIONS, [user(THEM), user('other')]);
    client.setQueryData(THREAD, [message('m1')]);
    mockDeleteConversation.mockResolvedValue(true);

    await run(client, deleteConversationOptions(client, ME), THEM);

    expect(client.getQueryData<SimpleUser[]>(CONVERSATIONS)!.map((u) => u.id)).toEqual(['other']);
    expect(threadOf(client)).toBeUndefined();
  });

  it('puts it back when the server refuses', async () => {
    const client = newClient();
    client.setQueryData(CONVERSATIONS, [user(THEM)]);
    mockDeleteConversation.mockResolvedValue(false);

    await run(client, deleteConversationOptions(client, ME), THEM);

    expect(client.getQueryData<SimpleUser[]>(CONVERSATIONS)!.map((u) => u.id)).toEqual([THEM]);
  });
});

// ─── 4. Realtime ────────────────────────────────────────────────────────

describe('realtime messages', () => {
  it('appends an incoming message once, however many times it arrives', () => {
    const client = newClient();
    client.setQueryData(THREAD, [message('m1')]);
    const row = { id: 'm2', sender_id: THEM, receiver_id: ME, text: 'new', created_at: 'x', seen: false };

    applyIncomingMessage(client, ME, row);
    applyIncomingMessage(client, ME, row);

    expect(idsOf(client)).toEqual(['m1', 'm2']);
  });

  it('links an incoming reply to the message it answers', () => {
    const client = newClient();
    client.setQueryData(THREAD, [message('m1')]);

    applyIncomingMessage(client, ME, { id: 'm2', sender_id: THEM, receiver_id: ME, reply_to: 'm1' });

    expect(threadOf(client)![1].repliedMessage?.id).toBe('m1');
  });

  it('marks the sender unread', () => {
    const client = newClient();
    client.setQueryData(UNREAD, []);

    applyIncomingMessage(client, ME, { id: 'm2', sender_id: THEM, receiver_id: ME, seen: false });

    expect(client.getQueryData(UNREAD)).toEqual([THEM]);
  });

  it('never creates a thread or an unread set that has not loaded', () => {
    const client = newClient();

    applyIncomingMessage(client, ME, { id: 'm2', sender_id: THEM, receiver_id: ME, seen: false });

    expect(threadOf(client)).toBeUndefined();
    expect(client.getQueryData(UNREAD)).toBeUndefined();
  });

  it('re-reads a shared post with its joins before adding it', async () => {
    const client = newClient();
    client.setQueryData(THREAD, []);
    const hydrated = message('m3', { type: 'post_share', sharedPost: { id: 'p1' } as Post });
    mockFetchMessageById.mockResolvedValue(hydrated);

    applyIncomingMessage(client, ME, { id: 'm3', sender_id: THEM, receiver_id: ME, shared_post_id: 'p1' });
    await flush();

    expect(mockFetchMessageById).toHaveBeenCalledWith('m3');
    expect(threadOf(client)![0].sharedPost?.id).toBe('p1');
  });
});

// ─── 5. Persistence ─────────────────────────────────────────────────────

describe('persistence', () => {
  it('keeps every message key out of the persisted cache', () => {
    expect(messageKeys.all[0]).toBe('messages');
    for (const key of [THREAD, UNREAD, CONVERSATIONS]) {
      expect(isPersistable(key)).toBe(false);
    }
  });
});
