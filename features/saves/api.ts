// Pure Supabase access for Saves (ONE-39).
//
// No React, no hooks, nothing from another feature's internals. The post row
// comes from services/postRows.ts, the shared ground for any feature that
// renders posts.

import { supabase } from '../../services/supabase.native';
import { POST_SELECT_QUERY, mapPostData, scopePostsToViewer } from '../../services/postRows';
import type { Post } from '../../types';
import type { Save, SaveKind, SaveRow, SaveTarget } from './types';

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

/** Every save a profile has made, newest first. */
export const fetchSaves = async (profileId: string): Promise<Save[]> => {
  const { data, error } = await supabase
    .from('saves')
    .select(SAVE_SELECT)
    .eq('profile_id', profileId)
    .order('saved_at', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as SaveRow[]).map(mapSaveRow).filter((save): save is Save => save !== null);
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

/**
 * A profile's saved posts, most recently saved first. Empty on error.
 *
 * Moved from features/posts (ONE-20 had rehomed it there from the old shared
 * service), now reading saves. The posts are scoped to the profile as viewer,
 * so each one's liked, reposted and saved state is the profile's own.
 */
export const getSavedPosts = async (profileId: string): Promise<Post[]> => {
  try {
    const { data: saved, error: savedError } = await supabase
      .from('saves')
      .select('saved_post_id, saved_at')
      .eq('profile_id', profileId)
      .not('saved_post_id', 'is', null)
      .order('saved_at', { ascending: false });

    if (savedError) throw savedError;
    if (!saved || saved.length === 0) return [];

    const rows = saved as { saved_post_id: string; saved_at: string }[];
    const { data: postsData, error: postsError } = await scopePostsToViewer(
      supabase.from('posts').select(POST_SELECT_QUERY).in('id', rows.map((r) => r.saved_post_id)),
      profileId,
    );

    if (postsError) throw postsError;
    if (!postsData) return [];

    // Order by when they were saved, not when they were posted.
    const savedAt = new Map(rows.map((r) => [r.saved_post_id, new Date(r.saved_at).getTime()]));
    return [...(postsData as { id: string }[])]
      .sort((a, b) => (savedAt.get(b.id) ?? 0) - (savedAt.get(a.id) ?? 0))
      .map(mapPostData);
  } catch (error) {
    console.error('Error fetching saved posts:', (error as Error).message || error);
    return [];
  }
};
