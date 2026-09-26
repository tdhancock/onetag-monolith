// Domain types for tags (ONE-30).
//
// A Tag is a portal to exactly one Destination. Resolving one answers three
// questions: does this code exist, is its tag live, and where does it go.

import type { ProfileId } from '../../types';

/**
 * Where a live tag sends someone.
 *
 * One member per destination kind the app can route to. A Destination is one
 * of four kinds — Business Profile, Individual Profile, Product, Project —
 * and both profile kinds are the one member here. Each kind has a column in
 * `resolve_tag` and a route in `lib/screens/tagResolution.ts`. A post is not
 * a Destination (ONE-83).
 */
export type TagDestination =
  | { kind: 'profile'; profileId: string; username: string }
  | { kind: 'product'; productId: string }
  | { kind: 'project'; projectId: string };

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
  dest_product_id: string | null;
  /** Returned for a private project too: the project screen decides who sees it (ONE-41). */
  dest_project_id: string | null;
}

/** Why a resolution could not be read, in terms a screen can say something about. */
export type TagResolutionFailure =
  /** The request never reached the server. */
  | 'offline'
  | 'failed';

// ─── A tag as its owner sees it (ONE-32, ONE-34) ────────────────────────

/**
 * The three kinds of Tag. Physical and Digital are created in the tag flow;
 * Embedded Tags are made in the post composer in M6 (ONE-44).
 */
export type TagType = 'physical' | 'digital' | 'embedded';

/** How a Physical Tag is carried. NFC is deferred, so QR is the only one. */
export type TagFormat = 'qr';

/**
 * Where an owner's tag points, with enough to show it.
 *
 * One member per destination kind, like `TagDestination`: M5 adds Products and
 * Projects (ONE-40, ONE-41) as members here and as sections in the create
 * flow's picker.
 */
export type OwnedTagDestination = {
  kind: 'profile';
  profileId: string;
  username: string;
  name: string;
  profileType: 'individual' | 'business';
};

/**
 * A Tag, as its owner reads it: the row, its destination, and how often it has
 * been scanned — never by whom (ONE-82).
 */
export interface OwnedTag {
  id: string;
  ownerProfileId: string;
  tagType: TagType;
  format: TagFormat | null;
  name: string | null;
  note: string | null;
  /** Issued by the database, printed on the object, and never changed. */
  shortCode: string;
  active: boolean;
  createdAt: string;
  /** Null when the destination is gone, or is a kind this build doesn't read. */
  destination: OwnedTagDestination | null;
  scanCount: number;
  lastScannedAt: string | null;
}

/** What creating a tag takes. The short code is the database's to issue. */
export interface NewTag {
  /** The active profile: the tag is attributed to it, never to the account. */
  ownerProfileId: ProfileId;
  tagType: Exclude<TagType, 'embedded'>;
  /** A profile the same account owns. RLS refuses any other. */
  destinationProfileId: string;
  name: string | null;
  note: string | null;
}

/** The fields an owner may change. `short_code` and the destination never. */
export interface TagUpdates {
  name?: string | null;
  note?: string | null;
}

/** A row of `public.tags` with its destination profile embedded. */
export interface TagRow {
  id: string;
  owner_profile_id: string;
  tag_type: TagType;
  format: TagFormat | null;
  name: string | null;
  note: string | null;
  short_code: string;
  active: boolean;
  created_at: string;
  dest_profile_id: string | null;
  /** A one-to-one embed arrives as an object; an older server or a mock may hand back an array. */
  dest_profile?: DestinationProfileRow | DestinationProfileRow[] | null;
}

export interface DestinationProfileRow {
  id: string;
  username: string;
  full_name: string | null;
  profile_type: 'individual' | 'business';
}

/** A row of `public.tag_scan_counts(p_owner_profile_id)`. */
export interface TagScanCountRow {
  tag_id: string;
  scan_count: number | string;
  last_scanned_at: string | null;
}
