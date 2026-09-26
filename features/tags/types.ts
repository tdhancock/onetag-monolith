// Domain types for tags (ONE-30).
//
// A Tag is a portal to exactly one Destination. Resolving one answers three
// questions: does this code exist, is its tag live, and where does it go.

/**
 * Where a live tag sends someone.
 *
 * One member per destination kind the app can route to. A Destination is one
 * of four kinds — Business Profile, Individual Profile, Product, Project —
 * and both profile kinds are the one member here. M5 adds Products and
 * Projects (ONE-40, ONE-41), each alongside a column in `resolve_tag` and a
 * route in `lib/screens/tagResolution.ts`. A post is not a Destination
 * (ONE-83).
 */
export type TagDestination = { kind: 'profile'; profileId: string; username: string };

export type TagDestinationKind = TagDestination['kind'];

/** What reading a short code found. */
export type TagResolution =
  /**
   * A live tag. `destination` is null when it points somewhere the app
   * cannot route: its target is gone, or is a kind this build doesn't know.
   */
  | { status: 'active'; tagId: string; destination: TagDestination | null }
  /** The tag exists, but its owner paused or replaced it. */
  | { status: 'inactive' }
  /** No tag has this code — or it is not the shape of one. */
  | { status: 'not-found' };

/** A row of `public.resolve_tag(p_short_code)`. */
export interface ResolveTagRow {
  /** Null unless the tag is active. */
  tag_id: string | null;
  active: boolean;
  dest_profile_id: string | null;
  dest_profile_username: string | null;
}

/** Why a resolution could not be read, in terms a screen can say something about. */
export type TagResolutionFailure =
  /** The request never reached the server. */
  | 'offline'
  | 'failed';
