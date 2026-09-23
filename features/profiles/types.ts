// Domain types for profiles.
//
// `UserProfile` and `SimpleUser` stay in the repo-root `types.ts` for now —
// shared vocabulary, imported by most screens from there — and are
// re-exported so callers can take everything about the domain from
// `features/profiles`.

export type { UserProfile, SimpleUser } from '../../types';

/** The `profiles` columns this feature reads. */
export type ProfileRow = {
    id: string;
    full_name: string;
    username: string;
    bio: string | null;
    avatar_url: string | null;
    is_verified: boolean;
    is_private: boolean;
};

/** The inverse of `mapProfileRow`: client field names → `profiles` columns. */
export type ProfileUpdates = Partial<
    Pick<import('../../types').UserProfile, 'name' | 'username' | 'bio' | 'profilePicture'>
>;
