// Pure Supabase access for the profiles domain.
//
// Everything about a person: their own identity row, other people's profiles,
// the posts on a profile screen, follower and following lists, and
// follow/unfollow itself. Moved out of the old shared service module in
// ONE-15; the implementations are unchanged except where noted below.
//
// No React, no hooks, nothing from another feature's internals.
//
// The module-level `profileCache` that sat in front of `getUserProfile` is
// gone: a Map keyed by username and never invalidated except on rename is
// exactly what the query cache replaces. `prefetchUserProfile` went with it —
// callers use `queryClient.prefetchQuery` with `profileKeys`.

import { supabase } from '../../services/supabase.native';
import { readLocalFile } from '../../services/localFile';
// The post select and mapper sit on shared ground in services/postRows.ts, so
// this api.ts imports no other feature (features/README.md, rule 1).
import { POST_SELECT_QUERY, mapPostData, scopePostsToViewer } from '../../services/postRows';
import type { Post } from '../../types';
import type {
    SimpleUser,
    UserProfile,
    ProfileRow,
    ProfileType,
    ProfileUpdates,
    BusinessProfileFields,
    BusinessProfileRow,
    BusinessProfileUpdates,
    AuthUserId,
    ProfileId,
    FollowRequest,
} from './types';

/**
 * Every column of a profile, with its business fields embedded (ONE-23).
 *
 * One request, not two: PostgREST follows `business_profiles.profile_id`
 * back to `profiles` and nests the row, so a profile screen never makes a
 * second round trip for a business profile's category and website. An
 * individual profile simply comes back with nothing embedded.
 */
export const PROFILE_SELECT = '*, business_profiles(category, website, location)';

/** A business row as the client reads it. */
const mapBusinessRow = (row: BusinessProfileRow): BusinessProfileFields => ({
    category: row.category,
    website: row.website,
    location: row.location,
});

export const mapProfileRow = (row: ProfileRow): UserProfile => {
    const profile = {
        id: row.id,
        name: row.full_name,
        username: row.username,
        bio: row.bio,
        profilePicture: row.avatar_url,
        isVerified: row.is_verified,
        isPrivate: row.is_private,
        scanHistoryPublic: row.scan_history_public === true,
        userId: row.user_id,
        profileType: row.profile_type,
    } as UserProfile;

    // Only a business profile carries business fields; the type guard in the
    // migration keeps an individual from having a row at all.
    if (row.profile_type === 'business') {
        const embedded = Array.isArray(row.business_profiles) ? row.business_profiles[0] : row.business_profiles;
        profile.business = embedded ? mapBusinessRow(embedded) : null;
    }
    return profile;
};

/** The inverse of `mapBusinessRow`: client field names → `business_profiles` columns. */
export const mapBusinessUpdatesToRow = (updates: BusinessProfileUpdates): Partial<BusinessProfileRow> => {
    const row: Partial<BusinessProfileRow> = {};
    if (updates.category !== undefined) row.category = updates.category;
    if (updates.website !== undefined) row.website = updates.website;
    if (updates.location !== undefined) row.location = updates.location;
    return row;
};

/** The inverse of `mapProfileRow`: client field names → `profiles` columns. */
export const mapProfileUpdatesToRow = (updates: ProfileUpdates): Partial<ProfileRow> => {
    const row: Partial<ProfileRow> = {};
    if (updates.name !== undefined) row.full_name = updates.name;
    if (updates.username !== undefined) row.username = updates.username;
    if (updates.bio !== undefined) row.bio = updates.bio;
    if (updates.profilePicture !== undefined) row.avatar_url = updates.profilePicture;
    if (updates.isPrivate !== undefined) row.is_private = updates.isPrivate;
    if (updates.scanHistoryPublic !== undefined) row.scan_history_public = updates.scanHistoryPublic;
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
        .select(PROFILE_SELECT)
        .eq('user_id', authUserId);

    if (error) throw error;

    const rank = (type: string | undefined) => (type === 'individual' ? 0 : 1);
    return (data || [])
        .map(mapProfileRow)
        .sort((a: UserProfile, b: UserProfile) => rank(a.profileType) - rank(b.profileType));
};

export const getUserProfile = async (username: string): Promise<UserProfile | null> => {
    const { data, error } = await supabase.from('profiles').select(PROFILE_SELECT).eq('username', username).single();
    if (error || !data) {
        console.error("Error fetching profile", error);
        return null;
    }
    return mapProfileRow(data);
};

/**
 * A profile's posts, newest first, scoped to the viewer as every post list is
 * (services/postRows.ts). Unscoped, the like and repost embeds carried every
 * row for every post. Since ONE-109 each of those rows also checks its post's
 * visibility.
 */
export const getUserPosts = async (userId: string, viewerId?: string): Promise<Post[]> => {
    const { data, error } = await scopePostsToViewer(
        supabase.from('posts').select(POST_SELECT_QUERY),
        viewerId,
    )
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    
    if (error) return [];
    return (data || []).map(mapPostData);
};

/**
 * How many posts a profile has, for the Posts figure in its header — a count,
 * never the posts themselves, so a profile whose first tab is not its posts
 * fetches none of them until that tab is opened (ONE-43). RLS counts only
 * what the viewer may see, as the grid shows.
 */
export const getUserPostCount = async (userId: string): Promise<number> => {
    const { count, error } = await supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
    return error ? 0 : count || 0;
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

// =========================================================
// Adding a profile (ONE-26)
// =========================================================

/** What adding a profile to an account takes: its kind, handle, name and an optional bio. */
export interface NewProfile {
    profileType: ProfileType;
    username: string;
    fullName: string;
    bio?: string | null;
}

/** Why adding a profile failed, in terms a screen can say something about. */
export type CreateProfileFailure =
    /** The handle is someone's — possibly claimed between the check and the insert. */
    | 'handle-taken'
    /** The account already holds a profile of this kind. */
    | 'kind-taken'
    | 'failed';

export class CreateProfileError extends Error {
    constructor(readonly reason: CreateProfileFailure, readonly cause?: unknown) {
        super(
            reason === 'handle-taken'
                ? 'That handle is taken.'
                : reason === 'kind-taken'
                    ? 'You already have a profile of that kind.'
                    : 'Could not create the profile.',
        );
        this.name = 'CreateProfileError';
    }
}

/**
 * Name the unique index a failed insert hit. Both of the ones that can refuse
 * a new profile surface as 23505; the constraint name tells them apart.
 */
export const createProfileFailureFor = (error: { code?: string; message?: string; details?: string } | null | undefined): CreateProfileFailure => {
    if (error?.code !== '23505') return 'failed';
    const text = `${error.message ?? ''} ${error.details ?? ''}`;
    if (text.includes('profiles_one_per_type')) return 'kind-taken';
    // The handle index, or a duplicate the server did not name: either way
    // the only unique thing the form chose is the handle.
    return 'handle-taken';
};

/**
 * Add a profile to the signed-in account, with a fresh id, and — for a
 * business profile — its `business_profiles` row, so it satisfies the type
 * guard and can be edited at once.
 *
 * One call to the `create_profile` function (ONE-80), which writes both rows
 * in one transaction: either both exist or neither does. It takes the account
 * from the session — `auth.uid()` — so there is no account argument to get
 * wrong.
 *
 * The handle is checked by the caller first, but two submissions, or a
 * handle claimed in between, still reach the unique index; that surfaces as
 * a `CreateProfileError` saying which one, never as a raw database error.
 *
 * No `PROFILE_SELECT` embed: PostgREST reads the embedded business row in the
 * statement's snapshot, taken before the function inserted it, so it would
 * always come back empty. A new business row has no fields yet anyway.
 */
export const createProfile = async (input: NewProfile): Promise<UserProfile> => {
    const { data, error } = await supabase.rpc('create_profile', {
        p_profile_type: input.profileType,
        p_username: input.username,
        p_full_name: input.fullName,
        p_bio: input.bio ?? null,
    });

    if (error || !data) throw new CreateProfileError(createProfileFailureFor(error), error);
    const created = mapProfileRow(data as ProfileRow);

    if (created.profileType === 'business') {
        created.business = { category: null, website: null, location: null };
    }

    return created;
};

/**
 * Save a business profile's own fields (ONE-23).
 *
 * An upsert on the profile id: a business profile left without its row —
 * created before `create_profile` made the two atomic (ONE-80), or converted
 * by the database owner — becomes editable on the first save rather than
 * silently updating nothing. The migration's type
 * guard rejects a row for an individual profile, and RLS a profile the
 * account does not own.
 */
export const updateBusinessProfile = async (profileId: ProfileId, updates: BusinessProfileUpdates): Promise<void> => {
    const row = mapBusinessUpdatesToRow(updates);
    const { error } = await supabase
        .from('business_profiles')
        .upsert({ profile_id: profileId, ...row }, { onConflict: 'profile_id' });
    if (error) throw error;
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
        .select('profiles!follower_id(id, username, full_name, avatar_url, is_verified, is_private)')
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
            isPrivate: profile.is_private === true,
        });
    });
    return Array.from(uniqueUsers.values());
};

export const getFollowingUsers = async (userId: string): Promise<SimpleUser[]> => {
    const { data, error } = await supabase
        .from('follows')
        .select('profiles!followed_id(id, username, full_name, avatar_url, is_verified, is_private)')
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
            isPrivate: profile.is_private === true,
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

    // Already following is what was asked for. The notification is the
    // database's to write, from the follow itself (ONE-107).
    if (error && error.code !== '23505') throw error;
};

export const unfollowUser = async (follower_id: ProfileId, followed_id: string): Promise<void> => {
    const { error } = await supabase.from('follows').delete().match({ follower_id, followed_id });
    if (error) throw error;
};

// =========================================================
// Follow requests (ONE-63)
// =========================================================
//
// A private profile is followed by request. RLS refuses a direct follow of
// one, and refuses a request to a public profile, so the app asking the wrong
// way is refused rather than quietly let through.

/** The usernames the viewer has asked to follow and is waiting on, lowercased. */
export const getRequestedList = async (requesterId: ProfileId): Promise<string[]> => {
    const { data, error } = await supabase
        .from('follow_requests')
        .select('target:profiles!target_profile_id(username)')
        .eq('requester_profile_id', requesterId);
    if (error) throw error;
    const unique = new Set<string>();
    for (const item of (data || []) as any[]) {
        const target = Array.isArray(item?.target) ? item.target[0] : item?.target;
        if (typeof target?.username === 'string' && target.username.trim().length > 0) {
            unique.add(target.username.toLowerCase());
        }
    }
    return Array.from(unique);
};

/**
 * Ask to follow a private profile. Asking twice is a no-op. The owner's
 * notification is written by the database from the request (ONE-107).
 */
export const requestFollow = async (requesterId: ProfileId, targetId: string): Promise<void> => {
    const { error } = await supabase
        .from('follow_requests')
        .insert({ requester_profile_id: requesterId, target_profile_id: targetId });

    if (error && error.code !== '23505') throw error;
};

/** Withdraw a request the viewer made. */
export const cancelFollowRequest = async (requesterId: ProfileId, targetId: string): Promise<void> => {
    const { error } = await supabase
        .from('follow_requests')
        .delete()
        .match({ requester_profile_id: requesterId, target_profile_id: targetId });
    if (error) throw error;
};

/** The requests waiting on one profile's approval, newest first. */
export const fetchFollowRequests = async (targetId: ProfileId): Promise<FollowRequest[]> => {
    const { data, error } = await supabase
        .from('follow_requests')
        .select('id, created_at, requester:profiles!requester_profile_id(id, username, full_name, avatar_url, is_verified)')
        .eq('target_profile_id', targetId)
        .order('created_at', { ascending: false });
    if (error) throw error;

    return ((data || []) as any[]).flatMap((row) => {
        const requester = Array.isArray(row.requester) ? row.requester[0] : row.requester;
        if (!requester?.id) return [];
        return [{
            id: row.id,
            createdAt: row.created_at,
            requester: {
                id: requester.id,
                username: requester.username,
                name: requester.full_name || requester.username,
                avatar: requester.avatar_url,
                isVerified: requester.is_verified || false,
            },
        }];
    });
};

/** Let a requester in: the follow is made and the request goes, in one call. */
export const approveFollowRequest = async (requestId: string): Promise<void> => {
    const { error } = await supabase.rpc('approve_follow_request', { p_request_id: requestId });
    if (error) throw error;
};

/** Turn a request down. Nothing is made, and the requester isn't told. */
export const declineFollowRequest = async (requestId: string): Promise<void> => {
    const { error } = await supabase.from('follow_requests').delete().eq('id', requestId);
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
/**
 * Profiles by handle, both kinds: Individual and Business. Each row carries
 * its `profile_type`, so a picker can say which kind it is (ONE-42).
 */
export const searchUsers = async (query: string): Promise<any[]> => {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url, is_verified, bio, profile_type')
        .ilike('username', `%${query}%`)
        .limit(10);
    if (error) return [];
    return data || [];
};

export const getSmartUserSuggestions = async(userId: ProfileId): Promise<any[]> => {
    // The newest profiles the viewer doesn't follow and isn't, from
    // `suggested_profiles`. It used to send every followed id back as
    // `.not('id', 'in', …)`, which put them all in the URL and broke at about
    // 200 follows (ONE-106).
    const { data: suggestionsData, error: suggestionsError } = await supabase
        .rpc('suggested_profiles', { p_viewer: userId, p_limit: 5 })
        // created_at is selected so the order can use it: PostgREST reads a
        // function's result only for the columns the select names.
        .select('id, username, avatar_url, is_verified, is_private, created_at')
        .order('created_at', { ascending: false });

    if (suggestionsError) {
        console.error('Error fetching user suggestions:', suggestionsError.message);
        return [];
    }

    // The shape the suggestions row expects. There is no mutual-follower
    // count, so it is 0.
    return ((suggestionsData || []) as any[]).map(profile => ({
        suggested_user_id: profile.id,
        username: profile.username,
        avatar_url: profile.avatar_url,
        is_verified: profile.is_verified,
        is_private: profile.is_private,
        mutual_followers: 0,
    }));
}

// =========================================================
// Chat / Messages
// =========================================================
