// Pure Supabase access for the profiles domain.
//
// Everything about a person: their own identity row, other people's profiles,
// the posts and reposts on a profile screen, follower and following lists,
// and follow/unfollow itself. Moved out of the old shared service module in
// ONE-15; the implementations are unchanged except where noted below.
//
// No React, no hooks, nothing from another feature's internals.
//
// The module-level `profileCache` that sat in front of `getUserProfile` is
// gone: a Map keyed by username and never invalidated except on rename is
// exactly what the query cache replaces. `prefetchUserProfile` went with it —
// callers use `queryClient.prefetchQuery` with `profileKeys`.

import { supabase } from '../../services/supabase.native';
import { sendNotification } from '../../services/notificationWrites';
import { readLocalFile } from '../../services/localFile';
// The post select and mapper sit on shared ground in services/postRows.ts, so
// this api.ts imports no other feature (features/README.md, rule 1).
import { POST_SELECT_QUERY, mapPostData } from '../../services/postRows';
import type { Post } from '../../types';
import type { SimpleUser, UserProfile, ProfileRow, ProfileUpdates, AuthUserId, ProfileId } from './types';

export const mapProfileRow = (row: ProfileRow): UserProfile => ({
    id: row.id,
    name: row.full_name,
    username: row.username,
    bio: row.bio,
    profilePicture: row.avatar_url,
    isVerified: row.is_verified,
    isPrivate: row.is_private,
    userId: row.user_id,
    profileType: row.profile_type,
} as UserProfile);

/** The inverse of `mapProfileRow`: client field names → `profiles` columns. */
export const mapProfileUpdatesToRow = (updates: ProfileUpdates): Partial<ProfileRow> => {
    const row: Partial<ProfileRow> = {};
    if (updates.name !== undefined) row.full_name = updates.name;
    if (updates.username !== undefined) row.username = updates.username;
    if (updates.bio !== undefined) row.bio = updates.bio;
    if (updates.profilePicture !== undefined) row.avatar_url = updates.profilePicture;
    if (updates.isPrivate !== undefined) row.is_private = updates.isPrivate;
    return row;
};

/**
 * Every profile an account owns, the Individual Profile first.
 *
 * Looked up by `user_id` — the account — not by `id`: since ONE-21 a profile
 * id is its own value, and an account can hold up to one profile of each
 * type. Empty when the account has none, which the app treats as a reason to
 * route to onboarding rather than an error.
 */
export const fetchMyProfiles = async (authUserId: AuthUserId): Promise<UserProfile[]> => {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', authUserId);

    if (error) throw error;

    const rank = (type: string | undefined) => (type === 'individual' ? 0 : 1);
    return (data || [])
        .map(mapProfileRow)
        .sort((a: UserProfile, b: UserProfile) => rank(a.profileType) - rank(b.profileType));
};

export const getUserProfile = async (username: string): Promise<UserProfile | null> => {
    const { data, error } = await supabase.from('profiles').select('*').eq('username', username).single();
    if (error || !data) {
        console.error("Error fetching profile", error);
        return null;
    }
    return mapProfileRow(data);
};

export const getUserPosts = async (userId: string): Promise<Post[]> => {
    const { data, error } = await supabase
        .from('posts')
        .select(POST_SELECT_QUERY)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    
    if (error) return [];
    return (data || []).map(mapPostData);
};

export const getUserReposts = async (userId: string): Promise<Post[]> => {
    try {
        const { data: repostIdsData, error: repostsError } = await supabase
            .from('reposts')
            .select('post_id, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (repostsError) throw repostsError;
        if (!repostIdsData || repostIdsData.length === 0) return [];
        
        const postIds = repostIdsData.map(r => r.post_id);
        const repostOrderMap = new Map<string, number>(repostIdsData.map((r: any) => [r.post_id, new Date(r.created_at).getTime()]));

        const { data: postsData, error: postsError } = await supabase
            .from('posts')
            .select(POST_SELECT_QUERY)
            .in('id', postIds);

        if (postsError) throw postsError;
        if (!postsData) return [];
        const sortedPosts = [...postsData].sort((a, b) => {
            // FIX: `repostOrderMap.get()` can return `undefined`. Using `?? 0` as a fallback ensures that `timeA` and `timeB` are always numbers, preventing a type error during the subtraction operation.
            const timeA = repostOrderMap.get(a.id) ?? 0;
            const timeB = repostOrderMap.get(b.id) ?? 0;
            return timeB - timeA;
        });

        return sortedPosts.map(mapPostData);

    } catch (error) {
        console.error("Error fetching user reposts:", (error as Error).message || error);
        return [];
    }
};

/**
 * Save edits to one profile — the one being acted as, by its profile id.
 *
 * It used to update the row whose id was the auth user id, which only held
 * while an account had exactly one profile with that id (ONE-22).
 */
export const updateUserProfileData = async (profileId: ProfileId, updates: ProfileUpdates): Promise<boolean> => {
    const row = mapProfileUpdatesToRow(updates);
    if (Object.keys(row).length === 0) return true;

    const { error } = await supabase.from('profiles').update(row).eq('id', profileId);
    if (error) {
        console.error('Profile update error:', error);
        return false;
    }

    return true;
};

/**
 * Upload a new avatar from a local URI and return its public URL.
 *
 * Takes a local URI rather than a Blob: `fetch(uri).blob()` is the web path and
 * yields an empty upload on React Native, which is why this shares
 * `readLocalFile` with `uploadMedia`. The path shape is fixed by storage RLS —
 * the avatars policies match `(storage.foldername(name))[2]` against
 * `auth.uid()`, so the uid must stay the second segment.
 */
export const uploadAvatar = async (localUri: string): Promise<string | null> => {
    // Account-scoped on purpose: storage RLS keys on auth.uid(), so the path
    // is built from the auth user, never from a profile id (ONE-21).
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    try {
        const { arrayBuffer, contentType, ext } = await readLocalFile(localUri);
        const filePath = `avatars/${user.id}/${Date.now()}.${ext}`;

        const { error } = await supabase.storage
            .from('avatars')
            .upload(filePath, arrayBuffer, { upsert: true, contentType, cacheControl: '3600' });

        if (error) {
            console.error('Avatar upload error:', error);
            return null;
        }

        const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
        return data.publicUrl ?? null;
    } catch (err) {
        console.error('Avatar upload error:', (err as Error).message || err);
        return null;
    }
};

// =========================================================
// Follows
// =========================================================

export const getFollowerCount = async (userId: string): Promise<number> => {
    const { count, error } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followed_id', userId);
    return error ? 0 : count || 0;
};

export const getFollowingCount = async (userId: string): Promise<number> => {
    const { count, error } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId);
    return error ? 0 : count || 0;
};

export const getFollowingList = async (userId: ProfileId): Promise<string[]> => {
    const { data, error } = await supabase.from('follows').select('profiles!followed_id(username)').eq('follower_id', userId);
    if (error) return [];
    const unique = new Set<string>();
    for (const item of data || []) {
        const profile = Array.isArray(item?.profiles)
            ? item.profiles[0]
            : item?.profiles;
        const username = profile?.username;
        if (typeof username === 'string' && username.trim().length > 0) {
            unique.add(username.toLowerCase());
        }
    }
    return Array.from(unique);
};

export const getFollowerUsers = async (userId: string): Promise<SimpleUser[]> => {
    const { data, error } = await supabase
        .from('follows')
        .select('profiles!follower_id(id, username, full_name, avatar_url, is_verified)')
        .eq('followed_id', userId);
    if (error || !data) return [];
    const uniqueUsers = new Map<string, SimpleUser>();
    data.forEach((item: any) => {
        const profile = Array.isArray(item?.profiles)
            ? item.profiles[0]
            : item?.profiles;
        if (!profile?.id || uniqueUsers.has(profile.id)) return;
        uniqueUsers.set(profile.id, {
            id: profile.id,
            username: profile.username,
            name: profile.full_name || profile.username,
            avatar: profile.avatar_url,
            isVerified: profile.is_verified || false,
        });
    });
    return Array.from(uniqueUsers.values());
};

export const getFollowingUsers = async (userId: string): Promise<SimpleUser[]> => {
    const { data, error } = await supabase
        .from('follows')
        .select('profiles!followed_id(id, username, full_name, avatar_url, is_verified)')
        .eq('follower_id', userId);
    if (error || !data) return [];
    const uniqueUsers = new Map<string, SimpleUser>();
    data.forEach((item: any) => {
        const profile = Array.isArray(item?.profiles)
            ? item.profiles[0]
            : item?.profiles;
        if (!profile?.id || uniqueUsers.has(profile.id)) return;
        uniqueUsers.set(profile.id, {
            id: profile.id,
            username: profile.username,
            name: profile.full_name || profile.username,
            avatar: profile.avatar_url,
            isVerified: profile.is_verified || false,
        });
    });
    return Array.from(uniqueUsers.values());
};

export const followUser = async (follower_id: ProfileId, followed_id: string): Promise<void> => {
    const { data: existingFollow, error: existingError } = await supabase
        .from('follows')
        .select('follower_id')
        .eq('follower_id', follower_id)
        .eq('followed_id', followed_id)
        .maybeSingle();

    if (existingError) {
        throw existingError;
    }
    if (existingFollow) {
        return;
    }

    const { error } = await supabase
        .from('follows')
        .insert({ follower_id, followed_id });

    if (error && error.code !== '23505') throw error;
    if (error?.code === '23505') return;

    await sendNotification({ senderId: follower_id, receiverId: followed_id, type: 'follow' });
};

export const unfollowUser = async (follower_id: ProfileId, followed_id: string): Promise<void> => {
    const { error } = await supabase.from('follows').delete().match({ follower_id, followed_id });
    if (error) throw error;
};

// =========================================================
// Comments
// =========================================================

export const checkUsernameExists = async (username: string): Promise<boolean> => {
    const { data, error } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', username)
        .maybeSingle();

    if (error) {
        console.error('Error checking username:', error);
        throw new Error('Could not verify username availability.');
    }
    return !!data;
};
// FIX: Add all missing functions below and export them.
// =========================================================
// Stories
// =========================================================
export const searchUsers = async (query: string): Promise<any[]> => {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url, is_verified, bio')
        .ilike('username', `%${query}%`)
        .limit(10);
    if (error) return [];
    return data || [];
};

export const getSmartUserSuggestions = async(userId: ProfileId): Promise<any[]> => {
    // The original RPC function 'get_user_suggestions' causes a "column reference is ambiguous" SQL error.
    // As we cannot modify the backend function, this implementation replaces it with a client-side query
    // that suggests recent users the current user is not already following.

    // 1. Get IDs of users the current user is following.
    const { data: followingData, error: followingError } = await supabase
        .from('follows')
        .select('followed_id')
        .eq('follower_id', userId);

    if (followingError) {
        console.error('Error fetching following list for suggestions:', followingError.message);
        return [];
    }

    // Create a list of user IDs to exclude from suggestions (followed users + the user themselves).
    const followingIds = followingData.map(f => f.followed_id);
    const excludeIds = [...followingIds, userId];

    // 2. Fetch a few recent profiles, excluding the ones in the `excludeIds` list.
    const { data: suggestionsData, error: suggestionsError } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, is_verified')
        .not('id', 'in', `(${excludeIds.join(',')})`)
        .order('created_at', { ascending: false })
        .limit(5);

    if (suggestionsError) {
        console.error('Error fetching user suggestions:', suggestionsError.message);
        return [];
    }

    // 3. Map the fetched profile data to the structure expected by the UserSuggestions component.
    // The 'mutual_followers' field is set to 0 as this simplified query does not calculate them.
    return (suggestionsData || []).map(profile => ({
        suggested_user_id: profile.id,
        username: profile.username,
        avatar_url: profile.avatar_url,
        is_verified: profile.is_verified,
        mutual_followers: 0,
    }));
}

// =========================================================
// Chat / Messages
// =========================================================
