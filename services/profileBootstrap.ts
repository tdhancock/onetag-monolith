// Making sure a signed-in account has a `profiles` row.
//
// Every write in the app is attributed to a profile, so anything that inserts
// on behalf of a user has to know the row exists first — posting, sending a
// notification, and the profile screens themselves.
//
// It lives in `services/` rather than in `features/profiles/` because
// `features/posts/api.ts` needs it too, and a feature's api.ts may not import
// another feature (features/README.md). A service is the shared ground.
// Extracted from the old shared service module in ONE-15, unchanged.

import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase.native';

export const DEFAULT_USER_BIO = 'Hello, I am using OneTag';

const sanitizeUsername = (value: string): string =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9_.]/g, '')
        .replace(/^[._]+|[._]+$/g, '')
        .slice(0, 20);

const buildUsernameCandidate = (base: string, attempt: number, userId: string): string => {
    const fallback = `user_${userId.slice(0, 6)}`;
    const normalizedBase = sanitizeUsername(base) || fallback;

    if (attempt === 0) {
        return normalizedBase.length >= 3 ? normalizedBase : `${normalizedBase}${userId.slice(0, 3)}`.slice(0, 20);
    }

    const suffix = `${attempt}${userId.slice(0, 3)}`.toLowerCase();
    const maxBaseLength = Math.max(3, 20 - suffix.length - 1);
    const trimmedBase = normalizedBase.slice(0, maxBaseLength);
    return `${trimmedBase}_${suffix}`.slice(0, 20);
};

/**
 * Whether an account owns at least one profile.
 *
 * By `user_id`, the account: since ONE-21 a profile's own id is not the auth
 * user id, so looking a profile up by `id = auth id` finds nothing for any
 * account created after the migration.
 */
export const profileExists = async (authUserId: string): Promise<boolean> => {
    const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', authUserId)
        .limit(1);

    if (error) {
        console.error('Profile check error:', error.message || error);
        return false;
    }

    return Boolean(data && data.length > 0);
};

export const ensureProfileRowForUser = async (user: User): Promise<boolean> => {
    if (await profileExists(user.id)) return true;

    const metadata = user.user_metadata || {};
    const fullName = typeof metadata.full_name === 'string' && metadata.full_name.trim().length > 0
        ? metadata.full_name.trim()
        : (user.email?.split('@')[0] || 'OneTag User');
    const avatarUrl = typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null;
    const bio = typeof metadata.bio === 'string' && metadata.bio.trim().length > 0
        ? metadata.bio.trim()
        : DEFAULT_USER_BIO;
    const baseUsername =
        (typeof metadata.username === 'string' && metadata.username) ||
        (typeof metadata.preferred_username === 'string' && metadata.preferred_username) ||
        (user.email?.split('@')[0] || '');

    for (let attempt = 0; attempt < 6; attempt += 1) {
        const username = buildUsernameCandidate(baseUsername, attempt, user.id);

        // The account's Individual Profile, with a fresh id. An insert, not
        // an upsert: this only runs when the account has no profile, and the
        // signup trigger may create one concurrently — a unique violation
        // then falls through to the final existence check below.
        const { error } = await supabase
            .from('profiles')
            .insert({
                user_id: user.id,
                profile_type: 'individual',
                username,
                full_name: fullName,
                avatar_url: avatarUrl,
                bio,
            });

        if (!error) {
            return true;
        }

        if (error.code === '23505') {
            continue;
        }

        console.error('Error ensuring profile row:', error.message || error);
        return false;
    }

    return profileExists(user.id);
};

export const ensureCurrentUserProfile = async (): Promise<boolean> => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
        console.error('Cannot ensure profile without an authenticated user.', error?.message || error);
        return false;
    }
    return ensureProfileRowForUser(user);
};

