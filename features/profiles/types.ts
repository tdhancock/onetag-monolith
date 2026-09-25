// Domain types for profiles.
//
// `UserProfile` and `SimpleUser` stay in the repo-root `types.ts` for now —
// shared vocabulary, imported by most screens from there — and are
// re-exported so callers can take everything about the domain from
// `features/profiles`.

export type { UserProfile, SimpleUser, ProfileType, BusinessProfileFields } from '../../types';

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
    /**
     * The embedded extension row, when the select asked for it (ONE-23).
     * PostgREST returns a one-to-one embed as an object, but an older server
     * or a mock may hand back a one-element array, so both are accepted.
     */
    business_profiles?: BusinessProfileRow | BusinessProfileRow[] | null;
};

/** The `business_profiles` columns this feature reads (ONE-23). */
export type BusinessProfileRow = {
    category: string | null;
    website: string | null;
    location: string | null;
    logo_url: string | null;
};

/** The inverse of `mapProfileRow`: client field names → `profiles` columns. */
export type ProfileUpdates = Partial<
    Pick<import('../../types').UserProfile, 'name' | 'username' | 'bio' | 'profilePicture' | 'isPrivate'>
>;

/** Edits to a business profile's own fields, in client field names. */
export type BusinessProfileUpdates = Partial<import('../../types').BusinessProfileFields>;
