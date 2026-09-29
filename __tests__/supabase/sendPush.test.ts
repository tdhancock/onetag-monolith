//
// target: __tests__/supabase/sendPush.test.ts
//
// The send-push edge function (ONE-103): the handler runs here against fake
// data and a fake Expo. What the database queues for it is pinned by
// supabase/tests/push_notifications.test.sql.

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  MESSAGE_SENTENCE,
  PUSH_NOTIFICATION_TYPES,
  PUSH_SENTENCES,
  buildPush,
  handleRequest,
  secretMatches,
  type ExpoMessage,
  type ExpoTicket,
  type PushDeps,
  type PushEvent,
} from '../../supabase/functions/send-push/handler';
import { notificationSentence } from '../../lib/screens/notifications';

const ROOT = join(__dirname, '..', '..');
const SECRET = 'shh-test-secret';

const RECEIVER = { authUserId: 'acct-r', username: 'ruth', profileType: 'individual' as const };

const follow: PushEvent = { kind: 'notification', type: 'follow', senderUsername: 'ana', receiver: RECEIVER, postId: null };

/** Fake deps that record what they were asked. */
const fakes = (overrides: Partial<PushDeps> = {}) => {
  const sent: ExpoMessage[][] = [];
  const deleted: string[] = [];
  const deps: PushDeps = {
    secret: SECRET,
    loadNotification: async () => follow,
    loadMessage: async () => ({ kind: 'message', senderUsername: 'ana', receiver: RECEIVER }),
    tokensFor: async () => ['ExponentPushToken[good]'],
    send: async (messages) => {
      sent.push(messages);
      return messages.map((): ExpoTicket => ({ status: 'ok' }));
    },
    deleteToken: async (token) => { deleted.push(token); },
    log: () => undefined,
    ...overrides,
  };
  return { deps, sent, deleted };
};

const post = (body: unknown, secret: string | null = SECRET) =>
  new Request('http://localhost/send-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-push-secret': secret } : {}) },
    body: JSON.stringify(body),
  });

describe('what each push says', () => {
  it('uses the Notifications screen\'s own sentence for every type that pushes', () => {
    for (const type of PUSH_NOTIFICATION_TYPES) {
      expect(PUSH_SENTENCES[type]).toBe(notificationSentence(type));
    }
  });

  it('routes a tap the way app/_layout.tsx expects', () => {
    expect(buildPush(follow)).toEqual({
      title: 'OneTag', body: 'ana started following you.', data: { type: 'follow', username: 'ana' }, sound: 'default',
    });
    expect(buildPush({ ...follow, type: 'follow_request' })!.data).toEqual({ type: 'follow_request' });
    expect(buildPush({ ...follow, type: 'comment', postId: 'post-1' })!.data).toEqual({ type: 'comment', postId: 'post-1' });
    // With the comment it's about, so a tap opens on it.
    expect(buildPush({ ...follow, type: 'reply', postId: 'post-1', commentId: 'c-1' })!.data).toEqual({
      type: 'reply',
      postId: 'post-1',
      commentId: 'c-1',
    });
    expect(buildPush({ ...follow, type: 'mention', postId: 'post-1' })!.body).toBe('ana mentioned you.');
  });

  it('says who a message is from, and never what it says', () => {
    const push = buildPush({ kind: 'message', senderUsername: 'ana', receiver: RECEIVER })!;
    expect(push.body).toBe(`ana ${MESSAGE_SENTENCE}`);
    expect(push.data).toEqual({ type: 'message', username: 'ana' });
  });

  it('names the business profile a push is for, since the account\'s profiles share the device', () => {
    const push = buildPush({ ...follow, receiver: { ...RECEIVER, username: 'oakworks', profileType: 'business' } })!;
    expect(push.title).toBe('@oakworks');
  });

  it('sends nothing for the types that don\'t push', () => {
    for (const type of ['like', 'repost', 'comment_like', 'story_like']) {
      expect(buildPush({ ...follow, type })).toBeNull();
    }
  });
});

describe('the request', () => {
  it('refuses a request without the shared secret', async () => {
    const { deps, sent } = fakes();
    expect((await handleRequest(post({ kind: 'notification', id: 'n1' }, null), deps)).status).toBe(401);
    expect((await handleRequest(post({ kind: 'notification', id: 'n1' }, 'wrong-secret-xx'), deps)).status).toBe(401);
    expect(sent).toEqual([]);
  });

  it('refuses a body that isn\'t { kind, id }', async () => {
    const { deps } = fakes();
    expect((await handleRequest(post({ kind: 'nope', id: 'n1' }), deps)).status).toBe(400);
    expect((await handleRequest(post({ kind: 'message' }), deps)).status).toBe(400);
  });

  it('sends one push per token of the receiving account', async () => {
    const { deps, sent } = fakes();
    const response = await handleRequest(post({ kind: 'notification', id: 'n1' }), deps);
    expect(await response.json()).toEqual({ sent: 1 });
    expect(sent).toEqual([[{ to: 'ExponentPushToken[good]', ...buildPush(follow)! }]]);
  });

  it('sends nothing when the row is gone, the kind doesn\'t push, or the account has no token', async () => {
    for (const overrides of [
      { loadNotification: async () => null },
      { loadNotification: async (): Promise<PushEvent> => ({ ...follow, type: 'like' }) },
      { tokensFor: async () => [] },
    ] as Partial<PushDeps>[]) {
      const { deps, sent } = fakes(overrides);
      expect(await (await handleRequest(post({ kind: 'notification', id: 'n1' }), deps)).json()).toEqual({ sent: 0 });
      expect(sent).toEqual([]);
    }
  });

  it('deletes a token Expo says is no longer registered, and keeps the rest', async () => {
    const { deps, deleted } = fakes({
      tokensFor: async () => ['ExponentPushToken[gone]', 'ExponentPushToken[good]'],
      send: async () => [
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'ok' },
      ],
    });
    expect(await (await handleRequest(post({ kind: 'message', id: 'm1' }), deps)).json()).toEqual({ sent: 1 });
    expect(deleted).toEqual(['ExponentPushToken[gone]']);
  });

  it('keeps a token after any other error', async () => {
    const { deps, deleted } = fakes({ send: async () => [{ status: 'error', details: { error: 'MessageRateExceeded' } }] });
    await handleRequest(post({ kind: 'notification', id: 'n1' }), deps);
    expect(deleted).toEqual([]);
  });

  it('answers 500 when Expo can\'t be reached, so pg_net records the failure', async () => {
    const { deps } = fakes({ send: async () => { throw new Error('network'); } });
    expect((await handleRequest(post({ kind: 'notification', id: 'n1' }), deps)).status).toBe(500);
  });
});

describe('secretMatches', () => {
  it('matches only the exact secret', () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches('shh-test-secreT', SECRET)).toBe(false);
    expect(secretMatches(null, SECRET)).toBe(false);
    expect(secretMatches('', '')).toBe(false);
  });
});

describe('wiring', () => {
  it('takes no JWT at the gateway, since the database calls it', () => {
    const config = readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8');
    expect(config).toMatch(/\[functions\.send-push\]\s*\nverify_jwt = false/);
  });

  it('is queued for exactly the types that push', () => {
    // The trigger as the latest migration to make it left it.
    const dir = join(ROOT, 'supabase', 'migrations');
    const latest = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => readFileSync(join(dir, name), 'utf8'))
      .filter((sql) => sql.includes('CREATE TRIGGER notifications_push'))
      .pop()!;
    const listed = latest.match(/WHEN \(NEW\.type IN \(([^)]*)\)\)/)![1]!.match(/'([a-z_]+)'/g)!.map((s) => s.slice(1, -1));
    expect(listed).toEqual([...PUSH_NOTIFICATION_TYPES]);
  });
});
