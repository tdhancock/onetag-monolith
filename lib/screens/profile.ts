
//
// Pure logic extracted from app/(tabs)/profile.tsx so the avatar fallback,
// bio display, follower/following stat rendering, and the Edit Profile
// button label/target can be exercised in tests without spinning up React
// Native, expo-router, or the AppContext provider.
//
// Keeping this logic in a sidecar file mirrors the convention used by
// SettingsScreen and LoginScreen — it lets the test suite lock down the
// behaviour the UI relies on, and gives the component a single, shared
// source of truth.

/**
 * Minimal shape of the user profile fields the ProfileScreen reads from
 * its `useApp()` context. The real `UserProfile` type contains many more
 * fields; this subset is what every helper here actually needs.
 */
export interface ProfileScreenProfile {
    id?: string;
    username: string;
    name?: string;
    bio?: string | null;
    profilePicture?: string | null;
    isVerified?: boolean;
}

// ---------------------------------------------------------------------------
// 1. Avatar rendering
// ---------------------------------------------------------------------------

/**
 * Resolves the image source the avatar component should render. Returns
 * `null` when the profile has no usable picture so the caller can fall
 * back to the initials-based avatar (which `Avatar` already handles
 * internally — we just have to decide whether to pass a URL at all).
 *
 * Empty strings and pure-whitespace strings are treated the same as
 * `null`/`undefined` because Supabase sometimes returns `""` for
 * users that have never uploaded a photo.
 */
export const resolveAvatarSource = (
    profile: Partial<ProfileScreenProfile> | null | undefined,
): string | null => {
    if (!profile || typeof profile !== 'object') return null;
    const pic = profile.profilePicture;
    if (typeof pic !== 'string') return null;
    const trimmed = pic.trim();
    if (trimmed === '') return null;
    return trimmed;
};

/**
 * Returns the two-letter initials shown inside the avatar fallback
 * bubble. The ProfileScreen delegates the actual rendering to
 * `Avatar`, but the initials are derived from `name` (preferred) or
 * `username` so the test can pin down the exact fallback string.
 */
export const getAvatarInitials = (
    profile: Partial<ProfileScreenProfile> | null | undefined,
): string => {
    if (!profile || typeof profile !== 'object') return '';
    const source = (profile.name && profile.name.trim()) || (profile.username && profile.username.trim()) || '';
    if (source === '') return '';

    // Split on any whitespace and pick the first letter of up to two
    // words. This matches what the Avatar primitive does
    // for the `name`-based fallback path.
    const words = source.split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
    return (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase();
};

// ---------------------------------------------------------------------------
// 2. Bio display
// ---------------------------------------------------------------------------

/**
 * Returns the bio text the ProfileScreen should render inside the
 * header. The component guards with `{userProfile.bio ? <Bio /> : null}`
 * — this helper centralises the same "is there anything to show?"
 * decision and trims stray whitespace from copy-pasted bios.
 *
 * Returns `null` when there is no bio to display so the caller can
 * short-circuit with a single nullish check.
 */
export const getBioText = (
    profile: Partial<ProfileScreenProfile> | null | undefined,
): string | null => {
    if (!profile || typeof profile !== 'object') return null;
    if (typeof profile.bio !== 'string') return null;
    const trimmed = profile.bio.trim();
    if (trimmed === '') return null;
    return profile.bio;
};

/**
 * Type guard mirroring the `{userProfile.bio ? … : null}` branch in the
 * component. Useful for components that want to call `getBioText` only
 * when this returns `true`.
 */
export const hasBio = (
    profile: Partial<ProfileScreenProfile> | null | undefined,
): boolean => getBioText(profile) !== null;

// ---------------------------------------------------------------------------
// 3. Follower / following counts
// ---------------------------------------------------------------------------

/**
 * Compact-format a stat count for display in the header row. The UI
 * shows raw integers today, but the helper is in place so the test can
 * pin down the threshold logic if/when the component starts abbreviating
 * large numbers (e.g. `1234` → `"1.2K"`). The current callers pass the
 * result straight into a `<Text>` so we keep it stringly-typed.
 *
 * Rules:
 *   - non-finite / non-number → `"0"`
 *   - negative values are clamped to `0` (a follow count should never
 *     be negative, but defensive code in the UI treats it as zero)
 *   - < 1_000            → exact integer (`"0"`, `"42"`, `"999"`)
 *   - < 1_000_000        → `"<n.n>K"` with one decimal, trailing `.0` stripped
 *   - >= 1_000_000       → `"<n.n>M"` with one decimal, trailing `.0` stripped
 */
export const formatStatCount = (value: number | null | undefined): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
    const safe = Math.max(0, value);
    if (safe < 1_000) return Math.trunc(safe).toString();
    if (safe < 1_000_000) {
        const k = safe / 1_000;
        return `${trimTrailingZero(k.toFixed(1))}K`;
    }
    const m = safe / 1_000_000;
    return `${trimTrailingZero(m.toFixed(1))}M`;
};

const trimTrailingZero = (formatted: string): string => {
    if (formatted.endsWith('.0')) return formatted.slice(0, -2);
    return formatted;
};

/**
 * Describes the three stat columns the header renders, in display order
 * (Posts, Followers, Following). The component renders exactly these
 * three columns, so locking the order and labels in a test catches any
 * accidental reorder during refactors.
 */
export const PROFILE_STAT_COLUMNS = ['Posts', 'Followers', 'Following'] as const;
export type ProfileStatColumn = typeof PROFILE_STAT_COLUMNS[number];

export interface ProfileStats {
    posts: number;
    followers: number;
    following: number;
}

/**
 * Resolves the `[value, label]` pair rendered inside each stat column.
 * Centralised so the test can verify the label is stable ("Followers"
 * not "Follower", etc.) and the value is formatted with `formatStatCount`.
 */
export const getStatCell = (
    stats: Partial<ProfileStats>,
    column: ProfileStatColumn,
): { value: string; label: ProfileStatColumn } => {
    switch (column) {
        case 'Posts':
            return { value: formatStatCount(stats.posts), label: 'Posts' };
        case 'Followers':
            return { value: formatStatCount(stats.followers), label: 'Followers' };
        case 'Following':
            return { value: formatStatCount(stats.following), label: 'Following' };
    }
};

// ---------------------------------------------------------------------------
// 4. Edit button
// ---------------------------------------------------------------------------

/**
 * Describes the rendered Edit Profile button. It opens the edit screen
 * itself; Settings has its own control in the profile's top bar. (It used to
 * open Settings too, one tap short of where the label said it went.)
 */
export const EDIT_PROFILE_LABEL = 'Edit Profile';
export const EDIT_PROFILE_TARGET = '/edit-profile';

export interface EditButtonProps {
    label: string;
    target: string;
    isEnabled: boolean;
}

/**
 * Resolves the props for the Edit Profile button. The button is hidden
 * when there is no logged-in user (`!userProfile` in the component),
 * which we surface here as `isEnabled: false` so the caller can apply
 * the same guard.
 */
export const getEditButtonProps = (
    profile: Partial<ProfileScreenProfile> | null | undefined,
): EditButtonProps => {
    const isEnabled = Boolean(profile && typeof profile.username === 'string' && profile.username.trim() !== '');
    return {
        label: EDIT_PROFILE_LABEL,
        target: EDIT_PROFILE_TARGET,
        isEnabled,
    };
};

// ---------------------------------------------------------------------------
// Private accounts (ONE-58)
// ---------------------------------------------------------------------------

/**
 * What the Private account switch in Settings says it does.
 *
 * Going private does not evict anyone: existing followers keep access, and
 * the copy says so, so nobody has to guess.
 */
export const PRIVATE_ACCOUNT_LABEL = 'Private account';
export const PRIVATE_ACCOUNT_DESCRIPTION =
  'Only your followers can see your posts. People who already follow you keep access.';

export interface ProfileVisibility {
  /** `profiles.is_private` on the profile being viewed. */
  isPrivate: boolean | undefined;
  /** The viewer is looking at their own profile. */
  isOwnProfile: boolean;
  /** The viewer follows this profile. */
  isFollowing: boolean;
  /** The viewer is an admin, whom the posts RLS lets through. */
  isAdmin?: boolean;
}

/**
 * Whether the profile screen shows the locked state instead of the grid.
 *
 * Mirrors the posts SELECT policy in 20260921000000_admin_and_privacy.sql:
 * the owner, an admin, and a follower see the posts of a private profile;
 * anyone else gets nothing back from the server. Showing "This account is
 * private" in that case explains the empty grid rather than implying the
 * profile has never posted.
 */
export const isProfileLocked = ({
  isPrivate,
  isOwnProfile,
  isFollowing,
  isAdmin = false,
}: ProfileVisibility): boolean => Boolean(isPrivate) && !isOwnProfile && !isFollowing && !isAdmin;

// ---------------------------------------------------------------------------
// Tabs, grid and empty states (ONE-68)
// ---------------------------------------------------------------------------

export type ProfileTab = 'posts' | 'reposts' | 'saved';

/** The tabs a profile shows: Saved is yours alone. */
export const profileTabsFor = (isOwnProfile: boolean): ProfileTab[] =>
  isOwnProfile ? ['posts', 'reposts', 'saved'] : ['posts', 'reposts'];

/** Each tab's accessibility label; the tabs themselves are icons. */
export const PROFILE_TAB_LABELS: Record<ProfileTab, string> = {
  posts: 'Posts',
  reposts: 'Reposts',
  saved: 'Saved',
};

export interface ProfileEmptyState {
  title: string;
  body: string;
  /** Your own empty Posts tab offers a way to fill it. */
  action?: { label: string; target: string };
}

/** What an empty tab says, which differs between your profile and someone else's. */
export const profileEmptyState = (tab: ProfileTab, isOwnProfile: boolean): ProfileEmptyState => {
  switch (tab) {
    case 'posts':
      return isOwnProfile
        ? {
            title: 'No posts yet',
            body: 'Share a photo or a thought.',
            action: { label: 'Create your first post', target: '/compose' },
          }
        : { title: 'No posts yet', body: 'Nothing has been posted here.' };
    case 'reposts':
      return isOwnProfile
        ? { title: 'No reposts yet', body: 'Posts you repost show up here.' }
        : { title: 'No reposts yet', body: 'Nothing has been reposted here.' };
    case 'saved':
      return { title: 'Nothing saved yet', body: 'Save posts to find them again here.' };
  }
};

/** The gap between grid tiles, in points. */
export const PROFILE_GRID_GAP = 1;
export const PROFILE_GRID_COLUMNS = 3;

/** A square tile's side: the width shared by three columns and two gaps. */
export const profileGridTileSize = (
  width: number,
  columns: number = PROFILE_GRID_COLUMNS,
  gap: number = PROFILE_GRID_GAP,
): number => (width - gap * (columns - 1)) / columns;

/** The first line of a text post, as its grid tile shows it. */
export const firstLine = (content: string | null | undefined): string =>
  (content ?? '').split('\n').map(line => line.trim()).find(Boolean) ?? '';

// ---------------------------------------------------------------------------
// User lists (ONE-68)
// ---------------------------------------------------------------------------

export type UserListType = 'followers' | 'following' | 'likes' | 'reposts';

/** What an empty list says, by what it lists. */
export const USER_LIST_EMPTY_TITLES: Record<UserListType, string> = {
  followers: 'No followers yet',
  following: 'Not following anyone yet',
  likes: 'No likes yet',
  reposts: 'No reposts yet',
};

export const userListEmptyTitle = (type: string | undefined): string =>
  USER_LIST_EMPTY_TITLES[type as UserListType] ?? 'No one here yet';

// ---------------------------------------------------------------------------
// Edit profile (ONE-68)
// ---------------------------------------------------------------------------

/** A handle's allowed length, as `profiles.username`'s CHECK constraint has it. */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/**
 * What is wrong with a username, or null when nothing is. Shared by Sign up
 * and Edit profile, so a handle cannot be changed into one sign-up would have
 * refused — a space or a capital breaks `/user/<username>` links. An empty
 * field reads as nothing to report yet; the caller decides whether empty may
 * be submitted.
 */
export const usernameError = (username: string): string | null => {
  if (username.length === 0) return null;
  if (!/^[a-z0-9_.]+$/.test(username)) return 'Only lowercase letters, numbers, "_", and "." are allowed.';
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    return `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters.`;
  }
  return null;
};

export interface EditableProfileFields {
  name: string;
  username: string;
  bio: string;
}

/**
 * Whether Edit profile has anything to save: a new photo, or a field that
 * differs from what the profile holds. Save stays disabled until it does.
 */
export const hasProfileChanges = (
  original: Partial<EditableProfileFields> | null | undefined,
  edited: EditableProfileFields,
  hasNewAvatar: boolean,
): boolean =>
  hasNewAvatar ||
  edited.name !== (original?.name ?? '') ||
  edited.username !== (original?.username ?? '') ||
  edited.bio !== (original?.bio ?? '');

// ---------------------------------------------------------------------------
// Business profiles (ONE-23)
// ---------------------------------------------------------------------------

/** The profile fields the business helpers read. */
export interface BusinessAwareProfile {
  profileType?: 'individual' | 'business';
  business?: {
    category: string | null;
    website: string | null;
    location: string | null;
  } | null;
}

/** What a business profile shows under its name, each part null when unset. */
export interface BusinessDetails {
  category: string | null;
  location: string | null;
  /** The stored link to open, and the shorter text to show for it. */
  website: { url: string; label: string } | null;
}

const present = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * The business details a profile header shows, or null for a profile that
 * shows none.
 *
 * Decided by `profileType`, never by which fields happen to be filled: an
 * individual profile renders exactly as it always has, and a business profile
 * that has not filled anything in yet shows nothing extra rather than
 * switching layouts once it does.
 */
export const businessDetailsFor = (profile: BusinessAwareProfile | null | undefined): BusinessDetails | null => {
  if (profile?.profileType !== 'business') return null;
  const business = profile.business;
  const url = present(business?.website);
  return {
    category: present(business?.category),
    location: present(business?.location),
    website: url ? { url, label: websiteLabel(url) } : null,
  };
};

/** A website as a profile shows it: no scheme, no trailing slash. */
export const websiteLabel = (url: string): string =>
  url.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');

/**
 * A website as it is stored: trimmed, scheme included, so it opens wherever
 * it is tapped. People type `example.com`, so a bare address gets `https://`;
 * one that already names http or https keeps it. Anything with another scheme
 * is returned as typed, for `websiteError` to refuse. Empty is null.
 */
export const normalizeWebsite = (input: string): string | null => {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/^https?/i, (scheme) => scheme.toLowerCase());
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[^:/]+:\d/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

/**
 * A web address the app will open: http or https, a host with a dot in it,
 * then an optional port and path. The database checks the scheme too, so the
 * two cannot drift into accepting something the other refuses.
 */
const WEBSITE_PATTERN = /^https?:\/\/([a-z0-9-]+\.)+[a-z]{2,}(:\d{1,5})?([/?#]\S*)?$/i;

export const WEBSITE_ERROR = 'Enter a web address, like example.com.';

/** What is wrong with a website entry, or null when nothing is. Empty is fine. */
export const websiteError = (input: string): string | null => {
  const normalized = normalizeWebsite(input);
  if (normalized === null) return null;
  return WEBSITE_PATTERN.test(normalized) ? null : WEBSITE_ERROR;
};

export interface EditableBusinessFields {
  category: string;
  website: string;
  location: string;
}

/** The business fields as the edit form holds them: plain strings, empty when unset. */
export const businessFormValues = (profile: BusinessAwareProfile | null | undefined): EditableBusinessFields => ({
  category: profile?.business?.category ?? '',
  website: profile?.business?.website ?? '',
  location: profile?.business?.location ?? '',
});

/** What the edit form's business fields save as: trimmed, empties as null, the website normalized. */
export const businessUpdatesFrom = (fields: EditableBusinessFields) => ({
  category: present(fields.category),
  website: normalizeWebsite(fields.website),
  location: present(fields.location),
});

/** Whether any business field would save differently from what is stored. */
export const hasBusinessChanges = (
  profile: BusinessAwareProfile | null | undefined,
  edited: EditableBusinessFields,
): boolean => {
  const before = businessUpdatesFrom(businessFormValues(profile));
  const after = businessUpdatesFrom(edited);
  return before.category !== after.category || before.website !== after.website || before.location !== after.location;
};

// ---------------------------------------------------------------------------
// The profile switcher (ONE-25)
// ---------------------------------------------------------------------------

export type ProfileKind = 'individual' | 'business';

/** Every kind of profile an account can hold, at most one of each. */
export const PROFILE_KINDS: readonly ProfileKind[] = ['individual', 'business'];

/** The mono label a profile carries in the switcher and the composer. */
export const profileKindLabel = (kind: ProfileKind | undefined): 'BUSINESS' | 'INDIVIDUAL' =>
  kind === 'business' ? 'BUSINESS' : 'INDIVIDUAL';

/** The kinds an account does not hold yet — what "Add a Profile" can create. */
export const missingProfileKinds = (profiles: readonly { profileType?: ProfileKind }[]): ProfileKind[] =>
  PROFILE_KINDS.filter(kind => !profiles.some(profile => (profile.profileType ?? 'individual') === kind));

/**
 * Whether the switcher offers "Add a Profile": only while a kind is missing.
 * With both, the one-of-each index makes a third impossible, and offering it
 * would only lead to an error.
 */
export const canAddProfile = (profiles: readonly { profileType?: ProfileKind }[]): boolean =>
  missingProfileKinds(profiles).length > 0;

export interface SwitcherRowProfile {
  username: string;
  name?: string;
  profileType?: ProfileKind;
}

/**
 * What a screen reader says for one switcher row: name, handle and kind, and
 * whether it is the one being acted as — in words, not only in colour.
 */
export const switcherRowLabel = (profile: SwitcherRowProfile, isActive: boolean): string => {
  const kind = profile.profileType === 'business' ? 'Business profile' : 'Individual profile';
  const name = profile.name || profile.username;
  return `${name}, @${profile.username}, ${kind}${isActive ? ', active' : ''}`;
};

/** What the composer says a post will publish as, for a screen reader. */
export const postingAsLabel = (profile: SwitcherRowProfile): string =>
  `Posting as @${profile.username}, ${profile.profileType === 'business' ? 'business' : 'individual'} profile`;

// ---------------------------------------------------------------------------
// Adding a profile (ONE-26)
// ---------------------------------------------------------------------------

/** The name field's label: a business profile's name is the business's. */
export const profileNameLabel = (kind: ProfileKind): string => (kind === 'business' ? 'Business name' : 'Name');

/** The create screen's title for the kind being added. */
export const createProfileTitle = (kind: ProfileKind): string =>
  kind === 'business' ? 'New business profile' : 'New individual profile';

export interface CreateProfileFields {
  username: string;
  /** The username rule's message, from `usernameError`. */
  usernameError: string | null;
  /** Where the live availability check stands (lib/screens/auth). */
  usernameStatus: 'idle' | 'checking' | 'available' | 'taken' | 'unknown';
  name: string;
}

/**
 * Whether Create can be pressed: a handle the database would accept and that
 * is not known to be taken (nor still being checked), and a name. The bio is
 * optional.
 */
export const createProfileFormValid = (fields: CreateProfileFields): boolean =>
  fields.username.length > 0 &&
  !fields.usernameError &&
  fields.usernameStatus !== 'taken' &&
  fields.usernameStatus !== 'checking' &&
  fields.name.trim().length > 0;

/** What the handle field says when the database refused the handle after all. */
export const HANDLE_TAKEN_MESSAGE = 'That handle is taken.';
