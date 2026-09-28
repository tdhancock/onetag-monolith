//
// target: __tests__/api/permissions.test.ts
//
// What someone signed out can't do, through the API itself. pgTAP pins the
// grants; this checks the API honours them, so reopening one fails here too.

import { anonClient } from './support/localStack';

const anon = anonClient();
const NOBODY = '00000000-0000-0000-0000-000000000000';

/** Every function only signed-in callers run, with arguments of the right shape. */
const SIGNED_IN_ONLY: [fn: string, args: Record<string, unknown>][] = [
  ['feed_posts', { p_viewer: NOBODY }],
  ['reel_stories', { p_viewer: NOBODY, p_since: new Date().toISOString() }],
  ['chat_list', { p_profile: NOBODY }],
  ['messages_thread', { p_profile: NOBODY, p_other: NOBODY }],
  ['following_usernames', { p_viewer: NOBODY }],
  ['requested_usernames', { p_requester: NOBODY }],
  ['suggested_profiles', { p_viewer: NOBODY }],
  ['blocked_profiles', { p_blocker: NOBODY }],
  ['accounts_for_usernames', { p_usernames: ['someone'] }],
  ['register_push_token', { p_token: 'ExponentPushToken[anon]', p_platform: 'ios' }],
  ['approve_follow_request', { p_request_id: NOBODY }],
  ['is_blocked_by', { target: NOBODY }],
];

describe('signed out', () => {
  it.each(SIGNED_IN_ONLY)('%s is refused', async (fn, args) => {
    const { error } = await anon.rpc(fn, args);
    expect(error?.code).toBe('42501');
  });

  it.each(['messages', 'notifications', 'push_tokens', 'follow_requests', 'saves', 'blocks'])(
    'reads nothing from %s',
    async (table) => {
      const { data } = await anon.from(table).select('*').limit(1);
      expect(data ?? []).toEqual([]);
    },
  );

  it('writes no notification', async () => {
    const { error } = await anon.from('notifications').insert({ sender_id: NOBODY, receiver_id: NOBODY, type: 'follow' });
    expect(error).toBeTruthy();
  });
});
