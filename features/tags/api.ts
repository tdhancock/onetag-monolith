// Pure Supabase access for the tags domain (ONE-30).
//
// No React, no hooks, nothing from another feature's internals.

import { supabase } from '../../services/supabase.native';
import { isValidShortCode } from '../../lib/tagLinks';
import type { ProfileId } from '../../types';
import type {
  DestinationProfileRow,
  NewTag,
  OwnedTag,
  OwnedTagDestination,
  ResolveTagRow,
  TagDestination,
  TagResolution,
  TagResolutionFailure,
  TagRow,
  TagScanCountRow,
  TagUpdates,
} from './types';

export class TagResolutionError extends Error {
  constructor(readonly reason: TagResolutionFailure, readonly cause?: unknown) {
    super(reason === 'offline' ? 'Could not reach OneTag.' : 'Could not resolve the tag.');
    this.name = 'TagResolutionError';
  }
}

/** Where a live tag's row points, or null when it points nowhere the app can route. */
const destinationOf = (row: ResolveTagRow): TagDestination | null => {
  if (row.dest_profile_id) {
    // A profile is public, so its handle is only missing if the profile is.
    return row.dest_profile_username
      ? { kind: 'profile', profileId: row.dest_profile_id, username: row.dest_profile_username }
      : null;
  }
  if (row.dest_product_id) return { kind: 'product', productId: row.dest_product_id };
  // A private project is routed like any other: its screen shows not-found to
  // anyone who may not see it, so nothing here special-cases it (ONE-41).
  if (row.dest_project_id) return { kind: 'project', projectId: row.dest_project_id };
  return null;
};

/** Read a `resolve_tag` row — or its absence — as a resolution. */
export const mapResolveTagRow = (row: ResolveTagRow | null): TagResolution => {
  if (!row) return { status: 'not-found' };
  if (!row.active || !row.tag_id) return { status: 'inactive' };
  return { status: 'active', tagId: row.tag_id, destination: destinationOf(row) };
};

/**
 * Resolve a short code: does it exist, is it live, and where does it go.
 *
 * Works without a session: a stranger scanning a sticker has no account, and
 * `resolve_tag` is granted to anon. A code that is not the shape of one the
 * database could have issued is not-found without a query — the path segment
 * came from a URL, and a QR code is attacker-controlled input.
 *
 * Throws a `TagResolutionError`: `offline` when the request never reached the
 * server (postgrest-js reports that as status 0), `failed` otherwise.
 */
export const resolveTag = async (shortCode: string): Promise<TagResolution> => {
  if (!isValidShortCode(shortCode)) return { status: 'not-found' };

  const { data, error, status } = await supabase
    .rpc('resolve_tag', { p_short_code: shortCode })
    .maybeSingle();

  if (error) throw new TagResolutionError(status === 0 ? 'offline' : 'failed', error);
  return mapResolveTagRow(data as ResolveTagRow | null);
};

/**
 * Record a Scan of a tag — attributed to the active profile, or to nobody.
 *
 * Inserted without reading the row back: an anonymous scanner may write a
 * scan but has no SELECT on `scans`, so asking for the row would fail the
 * insert. RLS refuses a scan attributed to a profile the caller does not own.
 */
export const recordScan = async (tagId: string, scannerProfileId: ProfileId | null): Promise<void> => {
  const { error } = await supabase
    .from('scans')
    .insert({ tag_id: tagId, scanner_profile_id: scannerProfileId });
  if (error) throw error;
};

// ─── The owner's tags (ONE-32, ONE-34) ──────────────────────────────────
//
// Only a tag's owner reads the tags table (ONE-82), so everything below runs
// as the owner, and RLS refuses it for anyone else.

/**
 * The columns an owner reads, with the destination profile embedded. `tags`
 * has two foreign keys to `profiles` — its owner and its destination — so the
 * embed names the column it follows.
 */
export const TAG_SELECT =
  'id, owner_profile_id, tag_type, format, name, note, short_code, active, created_at, dest_profile_id, ' +
  'dest_profile:profiles!dest_profile_id(id, username, full_name, profile_type)';

const one = <T>(embed: T | T[] | null | undefined): T | null =>
  Array.isArray(embed) ? embed[0] ?? null : embed ?? null;

const destinationFromRow = (row: TagRow): OwnedTagDestination | null => {
  const profile: DestinationProfileRow | null = one(row.dest_profile);
  if (row.dest_profile_id && profile) {
    return {
      kind: 'profile',
      profileId: profile.id,
      username: profile.username,
      name: profile.full_name || profile.username,
      profileType: profile.profile_type,
    };
  }
  // A destination column this build does not read yet (M5's products and
  // projects), or a profile the owner can no longer see.
  return null;
};

/** A tags row, and its scan count if there is one, as the owner's tag. */
export const mapTagRow = (row: TagRow, counts?: TagScanCountRow): OwnedTag => ({
  id: row.id,
  ownerProfileId: row.owner_profile_id,
  tagType: row.tag_type,
  format: row.format,
  name: row.name,
  note: row.note,
  shortCode: row.short_code,
  active: row.active,
  createdAt: row.created_at,
  destination: destinationFromRow(row),
  scanCount: counts ? Number(counts.scan_count) || 0 : 0,
  lastScannedAt: counts?.last_scanned_at ?? null,
});

/**
 * Every tag a profile owns, newest first, each with its scan count.
 *
 * The counts come from `tag_scan_counts` in one call, merged by tag id here.
 * An owner cannot read scan rows (ONE-82), so an embedded `scans(count)` would
 * always come back 0 — and scan rows are never fetched.
 */
export const fetchMyTags = async (ownerProfileId: ProfileId): Promise<OwnedTag[]> => {
  const [tags, counts] = await Promise.all([
    supabase
      .from('tags')
      .select(TAG_SELECT)
      .eq('owner_profile_id', ownerProfileId)
      .order('created_at', { ascending: false }),
    supabase.rpc('tag_scan_counts', { p_owner_profile_id: ownerProfileId }),
  ]);

  if (tags.error) throw tags.error;
  if (counts.error) throw counts.error;

  const byTag = new Map(((counts.data ?? []) as TagScanCountRow[]).map((row) => [row.tag_id, row]));
  return ((tags.data ?? []) as unknown as TagRow[]).map((row) => mapTagRow(row, byTag.get(row.id)));
};

/** The `tags` column each destination kind is stored in. */
const DESTINATION_COLUMN = {
  profile: 'dest_profile_id',
  product: 'dest_product_id',
  project: 'dest_project_id',
} as const;

/**
 * How many times an owner's tags pointing at one destination have been
 * scanned, all together — the scan count a project's owner sees on its page
 * (ONE-41). Never who scanned (ONE-82): it reads the owner's own tags and
 * `tag_scan_counts`, and never a scan row. For anyone but the owner both
 * come back empty, so the count is 0.
 */
export const fetchDestinationScanCount = async (
  ownerProfileId: ProfileId,
  destination: { kind: keyof typeof DESTINATION_COLUMN; id: string },
): Promise<number> => {
  const [tags, counts] = await Promise.all([
    supabase.from('tags').select('id').eq('owner_profile_id', ownerProfileId).eq(DESTINATION_COLUMN[destination.kind], destination.id),
    supabase.rpc('tag_scan_counts', { p_owner_profile_id: ownerProfileId }),
  ]);
  if (tags.error) throw tags.error;
  if (counts.error) throw counts.error;

  const pointing = new Set(((tags.data ?? []) as { id: string }[]).map((tag) => tag.id));
  return ((counts.data ?? []) as TagScanCountRow[])
    .filter((row) => pointing.has(row.tag_id))
    .reduce((total, row) => total + (Number(row.scan_count) || 0), 0);
};

/**
 * Create a tag and read it back.
 *
 * The short code is the column default's, issued by the database: a client
 * cannot guarantee uniqueness, and a code that is only provisional is
 * worthless on something printed. `format` is `qr` for a Physical Tag and
 * null for a Digital one — the only other difference between them.
 */
export const createTag = async (tag: NewTag): Promise<OwnedTag> => {
  const { data, error } = await supabase
    .from('tags')
    .insert({
      owner_profile_id: tag.ownerProfileId,
      tag_type: tag.tagType,
      format: tag.tagType === 'physical' ? 'qr' : null,
      name: tag.name,
      note: tag.note,
      dest_profile_id: tag.destinationProfileId,
    })
    .select(TAG_SELECT)
    .single();

  if (error) throw error;
  return mapTagRow(data as unknown as TagRow);
};

/**
 * Change a tag's name or note. Nothing else goes through here: the short code
 * is printed on objects, and the destination is what people scanned to reach.
 */
export const updateTag = async (tagId: string, updates: TagUpdates): Promise<void> => {
  const row: { name?: string | null; note?: string | null } = {};
  if (updates.name !== undefined) row.name = updates.name;
  if (updates.note !== undefined) row.note = updates.note;

  const { data, error } = await supabase.from('tags').update(row).eq('id', tagId).select('id');
  if (error) throw error;
  // RLS filters a row the caller does not own out of the update silently.
  if (!data || data.length === 0) throw new Error('Tag not found.');
};

/** Pause or resume a tag. A paused tag resolves to the inactive state. */
export const setTagActive = async (tagId: string, active: boolean): Promise<void> => {
  const { data, error } = await supabase.from('tags').update({ active }).eq('id', tagId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Tag not found.');
};

/**
 * Delete a tag. Irreversible: its scans go with it, and any object carrying
 * its code stops resolving for everyone.
 */
export const deleteTag = async (tagId: string): Promise<void> => {
  const { data, error } = await supabase.from('tags').delete().eq('id', tagId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Tag not found.');
};
