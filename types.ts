


// FIX: Define and export all shared types to resolve circular dependencies and import errors.

// ─── Identity (ONE-22) ─────────────────────────────────────────────────────────
//
// Since ONE-21 an account and a profile are different things with different
// ids. `AuthUserId` is the account — the Supabase session's user id, what
// push tokens, blocks, the admin flag and storage paths key on. `ProfileId`
// is who is acting — what posts, likes, follows and messages are attributed
// to. Both are strings at runtime; the brands exist so TypeScript refuses to
// pass one where the other is wanted, which is the whole bug class this
// separation invites.
//
// Every hook and API function that takes *the acting profile* takes a
// `ProfileId`; get one from `useCurrentProfile()`. Every account-scoped one
// takes an `AuthUserId`; get one from `useAuthUserId()`. Ids of *other*
// profiles, read off rows, stay plain strings.

declare const identityBrand: unique symbol;

/** An account: `auth.users.id`. */
export type AuthUserId = string & { readonly [identityBrand]: 'AuthUserId' };

/** A profile: `profiles.id`. */
export type ProfileId = string & { readonly [identityBrand]: 'ProfileId' };

/** Mark a string as an account id. Only where it demonstrably is one. */
export const asAuthUserId = (id: string): AuthUserId => id as AuthUserId;

/** Mark a string as a profile id. Only where it demonstrably is one. */
export const asProfileId = (id: string): ProfileId => id as ProfileId;

/** The two kinds of Profile an account can hold, at most one of each. */
export type ProfileType = 'individual' | 'business';
export interface SimpleUser {
    id: string;
    name: string;
    username: string;
    avatar: string | null;
    isVerified?: boolean;
    bio?: string;
}

export interface UserProfile {
    /**
     * The profile's own id — what posts, follows, likes and messages are
     * attributed to. Not the account's auth user id: an account can hold an
     * Individual and a Business Profile (ONE-21), each with its own id.
     */
    id: string;
    /** The account that owns this profile (`profiles.user_id`, the auth user id). */
    userId?: string;
    /** Individual or Business. */
    profileType?: ProfileType;
    name: string;
    username: string;
    bio: string;
    profilePicture: string | null;
    isVerified?: boolean;
    /** `profiles.is_private`: only followers see this profile's posts (ONE-58). */
    isPrivate?: boolean;
}

export interface PollOption {
    text: string;
    votes: number;
}

export interface Poll {
    question: string;
    options: PollOption[];
}

export interface Post {
    id:string;
    name?: string;
    username: string;
    avatar: string | null;
    content: string;
    media?: string;
    media_preview_url?: string;
    media_type: 'text' | 'image';
    // Nullable, not merely optional: the column is nullable, every row
    // written before ONE-55 holds null, and features/posts/api.ts maps that
    // straight through. PostCard falls back to 4:5 for both.
    media_aspect_ratio?: number | null;
    likes: number;
    reposts: number;
    replies: number;
    // The viewer's own relationship to this post, read from the cached
    // entity rather than from a parallel Set (ONE-13). Optional because a
    // post built client-side before publishing has no viewer state yet.
    isLiked?: boolean;
    isReposted?: boolean;
    isSaved?: boolean;
    isVerified?: boolean;
    poll?: Poll;
    timestamp?: string;
}

export interface NotificationSender {
    id: string;
    username: string;
    avatar_url: string | null;
}

export interface NotificationPost {
    id: string;
    content: string;
    media: string | null;
    media_type: 'text' | 'image';
}

export interface NotificationComment {
    id: string;
    text: string;
}

export interface NotificationStory {
    id: string;
    /** Null for a text OneSnap, which has no media (ONE-78). */
    media_url: string | null;
}

export interface Notification {
    id: string;
    type: 'like' | 'comment' | 'follow' | 'comment_like' | 'repost' | 'mention' | 'story_like';
    is_read: boolean;
    created_at: string;
    content?: string | null;
    sender: NotificationSender;
    user?: {
        id: string;
        username: string;
    } | null;
    post: NotificationPost | null;
    comment_id?: string | null;
    comment?: NotificationComment | null;
    story?: NotificationStory | null;
}

// Supabase returns foreign-key joins as arrays; use this helper to normalize.
export function normalizeNotification(n: any): Notification {
    const sender = Array.isArray(n.sender) ? n.sender[0] : n.sender;
    const post = Array.isArray(n.post) ? n.post[0] : n.post;
    const comment = Array.isArray(n.comment) ? n.comment[0] : n.comment;
    const story = Array.isArray(n.story) ? n.story[0] : n.story;
    return {
        ...n,
        sender: sender ?? { id: '', username: '', avatar_url: null },
        post: post ?? null,
        comment: comment ?? null,
        story: story ?? null,
    } as Notification;
}

export function normalizeNotifications(data: any[]): Notification[] {
    return (data || []).map(normalizeNotification);
}

export interface Comment {
    id: string;
    userId?: string;
    username: string;
    avatar: string | null;
    text: string;
    timestamp: Date;
    likes: number;
    isLiked: boolean;
    replies: Comment[];
}

export interface Story {
    id: string;
    userId: string;
    username: string;
    avatar: string | null;
    timestamp: string;
    imageUrl?: string;
    content?: string;
    /**
     * The gradient a text OneSnap is drawn on: a key into `oneSnapGradients`
     * (theme/tokens.ts). Null for image OneSnaps and for text ones posted
     * before ONE-78.
     */
    background?: string | null;
}

export interface Hashtag {
    tag: string;
    postCount: number;
}

export interface Toast {
    id: string;
    message: string;
    type?: 'info' | 'success' | 'error';
}

export interface Message {
    id: string;
    sender_id: string;
    receiver_id: string;
    text: string;
    created_at: string;
    type?: 'text' | 'profile_share' | 'post_share' | 'story_reply';
    shared_post_id?: string | null;
    shared_profile_id?: string | null;
    replied_story_id?: string | null;
    seen?: boolean;
    reply_to?: string | null;

    // For rendering, after client-side hydration
    sharedPost?: Post | null;
    sharedUser?: SimpleUser | null;
    repliedStory?: Story | null;
    repliedMessage?: Message | null;
}
