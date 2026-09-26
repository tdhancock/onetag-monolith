// Pure Supabase access for the tags domain (ONE-30).
//
// No React, no hooks, nothing from another feature's internals.

import { supabase } from '../../services/supabase.native';
import { isValidShortCode } from '../../lib/tagLinks';
import type { ProfileId } from '../../types';
import type { ResolveTagRow, TagDestination, TagResolution, TagResolutionFailure } from './types';

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
  // A destination column this build does not read yet (M5's products and
  // projects, before the app ships support for them).
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
