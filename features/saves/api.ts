// Pure Supabase access for Saves (ONE-39).
//
// No React, no hooks, nothing from another feature's internals. The post row
// comes from services/postRows.ts, the shared ground for any feature that
// renders posts.

import { supabase } from '../../services/supabase.native';
import { POST_SELECT_QUERY, mapPostData, scopePostsToViewer } from '../../services/postRows';
import { mapProductSummaryRow, PRODUCT_SUMMARY_SELECT, type ProductSummaryRow } from '../../services/productRows';
import { mapProjectSummaryRow, PROJECT_SUMMARY_SELECT, type ProjectSummaryRow } from '../../services/projectRows';
import type { Save, SavedItem, SavedProfile, SaveKind, SaveRow, SaveTarget } from './types';

/** The column each kind of target is saved in. */
export const SAVE_TARGET_COLUMN: Record<SaveKind, keyof SaveRow> = {
  post: 'saved_post_id',
  product: 'saved_product_id',
  project: 'saved_project_id',
  profile: 'saved_profile_id',
};

const KINDS = Object.keys(SAVE_TARGET_COLUMN) as SaveKind[];

export const SAVE_SELECT = 'id, profile_id, saved_post_id, saved_product_id, saved_project_id, saved_profile_id, saved_at';

/** A stable string for a target — the toggle's id and a list key. */
export const saveKeyOf = (target: SaveTarget): string => `${target.kind}:${target.id}`;

/** A target back from its key, or null for one this build doesn't know. */
export const targetOfSaveKey = (key: string): SaveTarget | null => {
  const at = key.indexOf(':');
  const kind = key.slice(0, at) as SaveKind;
  const id = key.slice(at + 1);
  return at > 0 && id && KINDS.includes(kind) ? { kind, id } : null;
};

/** A saves row as a Save, or null if no target column is set. */
export const mapSaveRow = (row: SaveRow): Save | null => {
  const kind = KINDS.find((k) => row[SAVE_TARGET_COLUMN[k]]);
  if (!kind) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    target: { kind, id: row[SAVE_TARGET_COLUMN[kind]] as string },
    savedAt: row.saved_at,
  };
};

/** How many saves one request asks for — the API's own cap, `max_rows`. */
export const SAVES_PER_REQUEST = 1000;

/**
 * Every save a profile has made, newest first.
 *
 * Read a page at a time until the count is reached: one read stopped at the
 * API's 1,000 rows, and the oldest saves past that disappeared (ONE-110).
 * Counting, rather than stopping at a short page, holds whatever `max_rows`
 * is set to. A save made mid-read can shift a row onto the next page, so
 * rows are kept once each.
 */
export const fetchSaves = async (profileId: string): Promise<Save[]> => {
  const rows = new Map<string, SaveRow>();
  for (let from = 0; ; ) {
    const { data, error, count } = await supabase
      .from('saves')
      .select(SAVE_SELECT, { count: 'exact' })
      .eq('profile_id', profileId)
      .order('saved_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + SAVES_PER_REQUEST - 1);

    if (error) throw error;
    const page = (data ?? []) as SaveRow[];
    for (const row of page) if (!rows.has(row.id)) rows.set(row.id, row);
    from += page.length;
    if (page.length === 0 || from >= (count ?? 0)) break;
  }
  return [...rows.values()].map(mapSaveRow).filter((save): save is Save => save !== null);
};

/** Postgres' unique violation: already saved, which is what was asked for. */
const ALREADY_SAVED = '23505';

/** Save a target as a profile. Saving something already saved succeeds. */
export const saveTarget = async (profileId: string, target: SaveTarget): Promise<void> => {
  const { error } = await supabase
    .from('saves')
    .insert({ profile_id: profileId, [SAVE_TARGET_COLUMN[target.kind]]: target.id });
  if (error && error.code !== ALREADY_SAVED) throw error;
};

/** Remove a profile's save of a target. Removing one that isn't there succeeds. */
export const unsaveTarget = async (profileId: string, target: SaveTarget): Promise<void> => {
  const { error } = await supabase
    .from('saves')
    .delete()
    .eq('profile_id', profileId)
    .eq(SAVE_TARGET_COLUMN[target.kind], target.id);
  if (error) throw error;
};

/**
 * Flip a profile's save of a target: remove it if it is there, add it if not.
 * Resolves to the state it left behind.
 *
 * For callers whose cache does not hold the profile's save list — a post's
 * save state lives on the post itself (`Post.isSaved`), in every feed page
 * that shows it.
 */
export const toggleSave = async (profileId: string, target: SaveTarget): Promise<boolean> => {
  const column = SAVE_TARGET_COLUMN[target.kind];
  const { data: existing, error: readError } = await supabase
    .from('saves')
    .select('id')
    .eq('profile_id', profileId)
    .eq(column, target.id)
    .maybeSingle();

  if (readError) throw readError;

  if (existing) {
    await unsaveTarget(profileId, target);
    return false;
  }
  await saveTarget(profileId, target);
  return true;
};

// ─── Saved items, with what a list shows (ONE-43) ──────────────────────

const PROFILE_SUMMARY_SELECT = 'id, username, full_name, avatar_url, is_verified, profile_type';

type ProfileSummaryRow = {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  is_verified: boolean | null;
  profile_type: 'individual' | 'business';
};

/**
 * How many ids one request carries. Every id goes in the URL, and at about
 * 200 the gateway refuses it, so a profile with hundreds of saves lost its
 * whole Saves tab (ONE-106). A hundred keeps each URL well short of that.
 */
export const IDS_PER_REQUEST = 100;

/** Split ids into request-sized batches. */
export const inBatches = (ids: string[], size = IDS_PER_REQUEST): string[][] =>
  Array.from({ length: Math.ceil(ids.length / size) }, (_, i) => ids.slice(i * size, (i + 1) * size));

/** Rows of one table by id, as a map, a batch at a time. Nothing to read reads nothing. */
const byIds = async <TRow extends { id: string }>(
  read: (batch: string[]) => PromiseLike<{ data: unknown; error: unknown }>,
  ids: string[],
): Promise<Map<string, TRow>> => {
  const results = await Promise.all(inBatches(ids).map((batch) => read(batch)));
  const rows = new Map<string, TRow>();
  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of (data ?? []) as TRow[]) rows.set(row.id, row);
  }
  return rows;
};

/**
 * Every save a profile has made, newest first, each with its target ready to
 * list: a profile's Saves tab, mixing all four kinds (ONE-43).
 *
 * One read of the saves, then one read per kind that has any. Posts are
 * scoped to the profile as viewer, so each one's liked, reposted and saved
 * state is the profile's own. A target that does not come back — deleted, or
 * no longer the viewer's to see — is left out rather than shown as a gap.
 */
export const fetchSavedItems = async (profileId: string): Promise<SavedItem[]> => {
  const saves = await fetchSaves(profileId);
  const ids = (kind: SaveKind) => saves.filter((save) => save.target.kind === kind).map((save) => save.target.id);

  const [postRows, products, projects, profiles] = await Promise.all([
    byIds<{ id: string }>(
      (batch) => scopePostsToViewer(supabase.from('posts').select(POST_SELECT_QUERY).in('id', batch), profileId),
      ids('post'),
    ),
    byIds<ProductSummaryRow>((batch) => supabase.from('products').select(PRODUCT_SUMMARY_SELECT).in('id', batch), ids('product')),
    byIds<ProjectSummaryRow>((batch) => supabase.from('projects').select(PROJECT_SUMMARY_SELECT).in('id', batch), ids('project')),
    byIds<ProfileSummaryRow>((batch) => supabase.from('profiles').select(PROFILE_SUMMARY_SELECT).in('id', batch), ids('profile')),
  ]);
  const posts = new Map(Array.from(postRows, ([id, row]) => [id, mapPostData(row)] as const));

  const items: SavedItem[] = [];
  for (const save of saves) {
    const base = { saveId: save.id, savedAt: save.savedAt };
    const { kind, id } = save.target;
    if (kind === 'post' && posts.has(id)) items.push({ ...base, kind, post: posts.get(id)! });
    if (kind === 'product' && products.has(id)) items.push({ ...base, kind, product: mapProductSummaryRow(products.get(id)!) });
    if (kind === 'project' && projects.has(id)) items.push({ ...base, kind, project: mapProjectSummaryRow(projects.get(id)!) });
    if (kind === 'profile' && profiles.has(id)) {
      const row = profiles.get(id)!;
      const profile: SavedProfile = {
        id: row.id,
        username: row.username,
        name: row.full_name || row.username,
        avatarUrl: row.avatar_url,
        isVerified: row.is_verified === true,
        profileType: row.profile_type,
      };
      items.push({ ...base, kind, profile });
    }
  }
  return items;
};
