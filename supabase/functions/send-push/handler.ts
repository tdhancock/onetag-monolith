// Push notifications (ONE-103): the request handler, kept free of Deno so Jest
// can run it. index.ts wires it to Supabase and Expo.
//
// A trigger calls this, never the app. When a notification of a type that
// pushes is written, or a direct message, the database queues a POST here
// through pg_net: `{ "kind": "notification" | "message", "id": "<row id>" }`,
// with the shared secret in `x-push-secret`. This loads the row with the
// service role, finds the receiving account's push token, and sends through
// Expo. The trigger side is in 20260928130000_push_notifications.sql.
//
// Decided 2026-09-27 (ONE-103):
//   - these push: follow, follow_request, comment, mention, and messages.
//     Likes, reposts, comment likes and OneSnap likes don't.
//   - a message's push says who it's from, never what it says.
//   - a token Expo reports as DeviceNotRegistered is deleted.
//
// Each push's text is the Notifications screen's own sentence
// (lib/screens/notifications.ts). Deno can't import the app, so the sentences
// are mirrored here, and __tests__/supabase/sendPush.test.ts keeps them in step.

export const PUSH_NOTIFICATION_TYPES = ['follow', 'follow_request', 'comment', 'mention'] as const;
export type PushNotificationType = (typeof PUSH_NOTIFICATION_TYPES)[number];

/** Mirrors notificationSentence in lib/screens/notifications.ts. */
export const PUSH_SENTENCES: Record<PushNotificationType, string> = {
  follow: 'started following you.',
  follow_request: 'asked to follow you.',
  comment: 'commented on your post.',
  mention: 'mentioned you.',
};

export const MESSAGE_SENTENCE = 'sent you a message.';

/** Whoever receives a push: the profile addressed, and the account it belongs to. */
export interface PushReceiver {
  authUserId: string;
  username: string;
  profileType: 'individual' | 'business';
}

export type PushEvent =
  | {
      kind: 'notification';
      type: string;
      senderUsername: string;
      receiver: PushReceiver;
      postId: string | null;
    }
  | {
      kind: 'message';
      senderUsername: string;
      receiver: PushReceiver;
    };

/** One Expo push message. */
export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: 'default';
}

/** Expo's answer for one message. */
export interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export interface PushDeps {
  /** The shared secret the trigger sends. */
  secret: string;
  loadNotification(id: string): Promise<PushEvent | null>;
  loadMessage(id: string): Promise<PushEvent | null>;
  /** The account's active push tokens. */
  tokensFor(authUserId: string): Promise<string[]>;
  /** Send to Expo, one ticket per message, in order. */
  send(messages: ExpoMessage[]): Promise<ExpoTicket[]>;
  deleteToken(token: string): Promise<void>;
  log?: (message: string, error?: unknown) => void;
}

/**
 * The push for an event, without its address, or null when this kind
 * doesn't push. The data is what app/_layout.tsx routes a tap by.
 */
export const buildPush = (event: PushEvent): Omit<ExpoMessage, 'to'> | null => {
  // An account can hold a Business Profile as well as its Individual one, and
  // both share the device. A push to the business says which profile it's for.
  const title = event.receiver.profileType === 'business' ? `@${event.receiver.username}` : 'OneTag';
  const sender = event.senderUsername;

  if (event.kind === 'message') {
    return { title, body: `${sender} ${MESSAGE_SENTENCE}`, data: { type: 'message', username: sender }, sound: 'default' };
  }

  if (!(PUSH_NOTIFICATION_TYPES as readonly string[]).includes(event.type)) return null;
  const type = event.type as PushNotificationType;
  const body = `${sender} ${PUSH_SENTENCES[type]}`;

  switch (type) {
    case 'follow':
      return { title, body, data: { type, username: sender }, sound: 'default' };
    case 'follow_request':
      return { title, body, data: { type }, sound: 'default' };
    case 'comment':
    case 'mention':
      return { title, body, data: event.postId ? { type, postId: event.postId } : { type }, sound: 'default' };
  }
};

/** Compare without leaking, through timing, how much of the secret matched. */
export const secretMatches = (given: string | null, expected: string): boolean => {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
};

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Send the push for one queued row. */
export const handleRequest = async (request: Request, deps: PushDeps): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  if (!secretMatches(request.headers.get('x-push-secret'), deps.secret)) return json(401, { error: 'Not allowed' });

  let kind: unknown;
  let id: unknown;
  try {
    ({ kind, id } = (await request.json()) as { kind?: unknown; id?: unknown });
  } catch {
    return json(400, { error: 'Expected JSON' });
  }
  if ((kind !== 'notification' && kind !== 'message') || typeof id !== 'string') {
    return json(400, { error: 'Expected { kind, id }' });
  }

  try {
    const event = kind === 'notification' ? await deps.loadNotification(id) : await deps.loadMessage(id);
    // Deleted before the queue reached it, or a kind that doesn't push.
    const push = event ? buildPush(event) : null;
    if (!event || !push) return json(200, { sent: 0 });

    const tokens = await deps.tokensFor(event.receiver.authUserId);
    if (tokens.length === 0) return json(200, { sent: 0 });

    const tickets = await deps.send(tokens.map((to) => ({ to, ...push })));

    let sent = 0;
    for (const [i, ticket] of tickets.entries()) {
      if (ticket.status === 'ok') {
        sent += 1;
      } else if (ticket.details?.error === 'DeviceNotRegistered' && tokens[i]) {
        // The app was uninstalled, or the token rotated: it will never work again.
        await deps.deleteToken(tokens[i]!);
      } else {
        deps.log?.('Expo refused a push', ticket);
      }
    }
    return json(200, { sent });
  } catch (error) {
    deps.log?.('Failed to send a push', error);
    return json(500, { error: 'Failed to send' });
  }
};
