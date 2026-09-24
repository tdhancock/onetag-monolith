// Pure Supabase access for admin-only actions.
//
// Moved out of the old shared service module in ONE-20, together with the admin flag
// AppContext used to read off the profile row at sign-in. The flag now comes
// from `public.is_admin()`, the same function every admin RLS policy calls,
// so the client and the database cannot disagree about who is an admin.

import { supabase } from '../../services/supabase.native';

/** Whether the signed-in account is an admin. False when signed out or on error. */
export const fetchIsAdmin = async (): Promise<boolean> => {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) {
    console.error('Could not read admin status:', error.message || error);
    return false;
  }
  return data === true;
};

/**
 * Set or clear a profile's verified badge. Admins only — RLS refuses anyone
 * else, which surfaces here as zero rows updated.
 */
export const setUserVerified = async (userId: string, status: boolean): Promise<void> => {
  const { data, error } = await supabase
    .from('profiles')
    .update({ is_verified: status })
    .eq('id', userId)
    .select();

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Update failed: No rows modified. Check permissions.');
  }
};
