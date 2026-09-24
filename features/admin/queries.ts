// Read hooks for admin state.

import { useQuery } from '@tanstack/react-query';
import { fetchIsAdmin } from './api';
import { adminKeys } from './keys';

/**
 * True when the signed-in account is an admin.
 *
 * Keyed by the auth user id because admin is a property of the account, not
 * of a profile. Reads false while loading and while signed out, so nothing
 * admin-only flashes on screen.
 */
export const useIsAdmin = (authUserId: string | undefined): boolean => {
  const { data } = useQuery<boolean>({
    queryKey: adminKeys.isAdmin(authUserId ?? ''),
    queryFn: fetchIsAdmin,
    enabled: Boolean(authUserId),
    staleTime: Infinity,
  });
  return data === true;
};
