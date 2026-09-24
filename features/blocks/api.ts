// Pure Supabase access for the blocks domain.
//
// Blocking used to live entirely in AsyncStorage under `onetag-blocked-users`:
// a Set of usernames that hid people from lists this device rendered and did
// nothing else. The server is the source of truth now — `public.blocks`, with
// RLS that stops a blocked account messaging or commenting, and policies that
// keep a block readable only by the person who made it.
//
// No React and nothing from another feature; the client and `./types` only.

import { supabase } from '../../services/supabase.native';
import type { BlockedUser } from './types';

/**
 * Everyone this user has blocked, newest first.
 *
 * Two queries rather than an embed: `blocks` references `auth.users`, as the
 * ticket specifies, and PostgREST can only embed across a foreign key — there
 * is none from `blocks` to `profiles`. Adding a second FK purely to make the
 * join expressible would be schema contortion for a list that is, in
 * practice, a handful of rows.
 *
 * RLS restricts this to the caller's own rows, so the `blocker_id` filter is
 * belt and braces rather than the protection — but it keeps the query honest
 * about what it is asking for.
 */
export const fetchBlocks = async (blockerId: string): Promise<BlockedUser[]> => {
  const { data: blocks, error } = await supabase
    .from('blocks')
    .select('blocked_id, created_at')
    .eq('blocker_id', blockerId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (!blocks || blocks.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url')
    .in('id', blocks.map((b: { blocked_id: string }) => b.blocked_id));

  if (profileError) throw profileError;

  const byId = new Map((profiles || []).map((p: any) => [p.id, p]));

  return blocks.map((block: { blocked_id: string; created_at: string }) => {
    const profile = byId.get(block.blocked_id) || {};

    return {
      userId: block.blocked_id,
      // A blocked account whose profile row has gone is still blocked. It
      // renders as a placeholder rather than vanishing from the list, so
      // there is always something to unblock.
      username: profile.username || 'unknown_user',
      name: profile.full_name ?? null,
      avatarUrl: profile.avatar_url ?? null,
      blockedAt: block.created_at,
    };
  });
};

/** Block someone. Idempotent: blocking twice is not an error. */
export const blockUser = async (blockerId: string, blockedId: string): Promise<void> => {
  const { error } = await supabase
    .from('blocks')
    .upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: 'blocker_id,blocked_id' });

  if (error) throw error;
};

/** Unblock someone. Idempotent in the same way. */
export const unblockUser = async (blockerId: string, blockedId: string): Promise<void> => {
  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);

  if (error) throw error;
};

/**
 * Resolve usernames to auth user ids.
 *
 * Used by the one-time AsyncStorage migration: the local list stored
 * usernames, `blocks` keys on ids, and an account that has since been deleted
 * or renamed simply drops out rather than failing the whole migration.
 */
export const resolveUsernames = async (usernames: string[]): Promise<string[]> => {
  if (usernames.length === 0) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .in('username', usernames);

  if (error) throw error;
  return (data || []).map((row: { id: string }) => row.id);
};

/**
 * Move a device-local block list into the database, once.
 *
 * Upserted rather than inserted so a user who blocked the same account on two
 * devices does not hit a conflict, and so re-running this is harmless. Anyone
 * the user cannot be resolved to an id is dropped — see `resolveUsernames`.
 *
 * Returns how many blocks landed, which the caller logs; a user who blocked
 * someone last week must not silently un-block them by updating the app.
 */
export const importLocalBlocks = async (
  blockerId: string,
  usernames: string[],
): Promise<number> => {
  const ids = (await resolveUsernames(usernames)).filter((id) => id !== blockerId);
  if (ids.length === 0) return 0;

  const { error } = await supabase
    .from('blocks')
    .upsert(
      ids.map((blockedId) => ({ blocker_id: blockerId, blocked_id: blockedId })),
      { onConflict: 'blocker_id,blocked_id' },
    );

  if (error) throw error;
  return ids.length;
};
