// Supabase Edge Function: send-push (ONE-103)
//
// Turns a notification or a direct message into a push. The database calls
// it through pg_net, never the app, so it takes no JWT (`verify_jwt = false`
// in supabase/config.toml) and checks a shared secret instead. It reads with
// the service role, because it must see the receiver's push token, which RLS
// keeps to its owner. What it does is in handler.ts; how to deploy it is in
// docs/push-notifications.md.
//
// Environment:
//   PUSH_WEBHOOK_SECRET  the same value as the vault secret send_push_secret
//   EXPO_ACCESS_TOKEN    optional; needed only if the Expo project enforces
//                        push security
//   EXPO_PUSH_URL        optional; Expo's endpoint by default. Local checks
//                        point it at a stand-in.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRequest } from './handler.ts';
import type { ExpoMessage, ExpoTicket, PushEvent, PushReceiver } from './handler.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EXPO_PUSH_URL = Deno.env.get('EXPO_PUSH_URL') ?? 'https://exp.host/--/api/v2/push/send';
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN');

type ProfileEmbed = { username: string; user_id?: string; profile_type?: string } | null;
const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

const receiverOf = (profile: ProfileEmbed): PushReceiver | null =>
  profile?.user_id
    ? {
        authUserId: profile.user_id,
        username: profile.username,
        profileType: profile.profile_type === 'business' ? 'business' : 'individual',
      }
    : null;

Deno.serve((request) =>
  handleRequest(request, {
    secret: Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '',

    async loadNotification(id): Promise<PushEvent | null> {
      const { data, error } = await admin
        .from('notifications')
        .select(
          'type, post_id, sender:profiles!notifications_sender_id_fkey(username), receiver:profiles!notifications_receiver_id_fkey(username, user_id, profile_type)',
        )
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      const sender = one(data?.sender as ProfileEmbed | ProfileEmbed[]);
      const receiver = receiverOf(one(data?.receiver as ProfileEmbed | ProfileEmbed[]));
      if (!data || !sender || !receiver) return null;
      return { kind: 'notification', type: data.type, senderUsername: sender.username, receiver, postId: data.post_id ?? null };
    },

    async loadMessage(id): Promise<PushEvent | null> {
      const { data, error } = await admin
        .from('messages')
        .select(
          'sender:profiles!messages_sender_id_fkey(username), receiver:profiles!messages_receiver_id_fkey(username, user_id, profile_type)',
        )
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      const sender = one(data?.sender as ProfileEmbed | ProfileEmbed[]);
      const receiver = receiverOf(one(data?.receiver as ProfileEmbed | ProfileEmbed[]));
      if (!data || !sender || !receiver) return null;
      return { kind: 'message', senderUsername: sender.username, receiver };
    },

    async tokensFor(authUserId) {
      const { data, error } = await admin
        .from('push_tokens')
        .select('token')
        .eq('user_id', authUserId)
        .eq('is_active', true);
      if (error) throw error;
      return (data ?? []).map((row: { token: string }) => row.token);
    },

    async send(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(messages),
      });
      if (!response.ok) throw new Error(`Expo answered ${response.status}`);
      const body = (await response.json()) as { data?: ExpoTicket[] };
      return body.data ?? [];
    },

    async deleteToken(token) {
      const { error } = await admin.from('push_tokens').delete().eq('token', token);
      if (error) throw error;
    },

    log: (message, error) => console.error(message, error),
  }),
);
