// Domain types for profiles.
//
// `UserProfile` and `SimpleUser` stay in the repo-root `types.ts` for now —
// shared vocabulary, imported by most screens from there — and are
// re-exported so callers can take everything about the domain from
// `features/profiles`.

export type { UserProfile, SimpleUser, ProfileType } from '../../types';

// ─── Identity ─────────────────────────────────────────────────────────
//
// `AuthUserId` (the account) and `ProfileId` (who is acting) are defined in
// the repo-root types.ts, beside `UserProfile`, because every feature's api.ts
// needs them and an api.ts may not import another feature. They are the
// profiles domain's vocabulary, so they are re-exported here — see the root
// file for what each one means and why they are branded (ONE-22).

export type { AuthUserId, ProfileId } from '../../types';
export { asAuthUserId, asProfileId } from '../../types';

/** The `profiles` columns this feature reads. */
export type ProfileRow = {
    id: string;
    full_name: string;
    username: string;
    bio: string | null;
    avatar_url: string | null;
    is_verified: boolean;
    is_private: boolean;
    user_id: string;
    profile_type: import('../../types').ProfileType;
};

/** The inverse of `mapProfileRow`: client field names → `profiles` columns. */
export type ProfileUpdates = Partial<
    Pick<import('../../types').UserProfile, 'name' | 'username' | 'bio' | 'profilePicture' | 'isPrivate'>
>;
