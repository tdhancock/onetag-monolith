// Pure Supabase access for moderation: reporting a post or an account.
//
// Moved out of the old shared service module in ONE-20. The reasons a user picks
// from live in services/reportReasons.ts, beside this feature, because the
// report sheets read them without needing any of this.
//
// Both writes are attributed to the reporting profile (`reports.reporter_id`
// references profiles) and return false rather than throwing: the report
// sheets show their own confirmation either way.

import { supabase } from '../../services/supabase.native';
import type { ProfileId } from '../../types';
import type { ReportTargetType } from './types';

const insertReport = async (
  reporterId: ProfileId,
  targetType: ReportTargetType,
  targetId: string,
  reason: string,
): Promise<boolean> => {
  const { error } = await supabase.from('reports').insert([
    {
      reporter_id: reporterId,
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
export const reportPost = (reporterId: ProfileId, postId: string, reason: string): Promise<boolean> =>
  insertReport(reporterId, 'post', postId, reason);

/** Report an account. */
export const reportUser = (reporterId: ProfileId, userId: string, reason: string): Promise<boolean> =>
  insertReport(reporterId, 'user', userId, reason);
