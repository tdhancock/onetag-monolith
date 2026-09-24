// Pure Supabase access for moderation: reporting a post or an account.
//
// Moved out of the old shared service module in ONE-20. The reasons a user picks
// from live in services/reportReasons.ts, beside this feature, because the
// report sheets read them without needing any of this.
//
// Both writes are attributed to the signed-in account and return false rather
// than throwing: the report sheets show their own confirmation either way.

import { supabase } from '../../services/supabase.native';
import type { ReportTargetType } from './types';

const insertReport = async (targetType: ReportTargetType, targetId: string, reason: string): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase.from('reports').insert([
    {
      reporter_id: user.id,
      target_type: targetType,
      target_id: targetId,
      reason,
    },
  ]);

  if (error) {
    console.error(`Error reporting ${targetType}:`, error.message || error);
    return false;
  }
  return true;
};

/** Report a post. */
export const reportPost = (postId: string, reason: string): Promise<boolean> =>
  insertReport('post', postId, reason);

/** Report an account. */
export const reportUser = (userId: string, reason: string): Promise<boolean> =>
  insertReport('user', userId, reason);
