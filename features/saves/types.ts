// Domain types for Saves (ONE-39).
//
// A Save bookmarks one of four kinds of thing for later — a personal
// inspiration board. Saves belong to a profile, and are private to it.

/** What can be saved. */
export type SaveKind = 'post' | 'product' | 'project' | 'profile';

/** One saveable thing, by kind and id. */
export interface SaveTarget {
  kind: SaveKind;
  id: string;
}

/** A profile's save of one target. */
export interface Save {
  id: string;
  profileId: string;
  target: SaveTarget;
  savedAt: string;
}

/** A saved profile, as a list shows it. */
export interface SavedProfile {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  isVerified: boolean;
  profileType: 'individual' | 'business';
}

/**
 * A save with what a list needs to show its target (ONE-43): the post, the
 * product or project summary, or the profile. A target the viewer can no
 * longer read — deleted, or a project made private — is simply not there.
 */
export type SavedItem = { saveId: string; savedAt: string } & (
  | { kind: 'post'; post: import('../../types').Post }
  | { kind: 'product'; product: import('../../services/productRows').ProductSummary }
  | { kind: 'project'; project: import('../../services/projectRows').ProjectSummary }
  | { kind: 'profile'; profile: SavedProfile }
);

/** A row of `public.saves`: exactly one target column is set. */
export interface SaveRow {
  id: string;
  profile_id: string;
  saved_post_id: string | null;
  saved_product_id: string | null;
  saved_project_id: string | null;
  saved_profile_id: string | null;
  saved_at: string;
}
