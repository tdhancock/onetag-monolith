// Pure Supabase access for stories (OneSnaps).
//
// Moved out of the old shared service module in ONE-19, along with the like-state
// read that `AppContext.syncUserData` ran inline. The media-upload helpers
// went to services/storyUpload.ts.
//
// Replying to a story is a direct message, so it is sent from mutations.ts
// through features/messages — a feature's api.ts may not import another
// feature (features/README.md, rule 1).

import { supabase } from '../../services/supabase.native';
import { ensureProfileRowForUser } from '../../services/profileBootstrap';
import { isLikelyStoragePolicyError, isStorageBucketMissingError } from '../../services/mediaUpload';
import { blobToDataUrl, buildTextStoryDataUri, uploadStoryMedia } from '../../services/storyUpload';
import type { Story, StoryViewer } from './types';
import type { ProfileId } from '../../types';

/** A story is live for 24 hours after it is posted. */
export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** The oldest `created_at` still live at `now`. */
export const liveCutoff = (now: number = Date.now()): string =>
  new Date(now - STORY_LIFETIME_MS).toISOString();

/** True while a story is inside its 24 hours. */
export const isLive = (story: Pick<Story, 'timestamp'>, now: number = Date.now()): boolean =>
  new Date(story.timestamp).getTime() > now - STORY_LIFETIME_MS;

const STORY_SELECT = '*, profiles!user_id(username, avatar_url)';

/** Map a joined story row onto the `Story` shape the UI renders. */
export const mapStoryRow = (s: any): Story => ({
  id: s.id,
  userId: s.user_id,
  username: s.profiles?.username,
  avatar: s.profiles?.avatar_url ?? null,
  timestamp: s.created_at,
  imageUrl: s.media_url,
  content: s.caption,
});

/**
 * The reel: live stories from everyone the signed-in user follows, and their
 * own, newest first.
 *
 * Throws on failure, so the query keeps the last good reel on screen instead
 * of blanking it — which is what the old "don't clear transiently" guard in
 * the home screen was for.
 */
export const getStories = async (viewerId: ProfileId): Promise<Story[]> => {
  // Follows belong to the profile being acted as, not the account (ONE-22).
  const { data: followingData, error: followingError } = await supabase
    .from('follows')
    .select('followed_id')
    .eq('follower_id', viewerId);

  const followingIds = !followingError && followingData
    ? followingData.map((f: { followed_id: string }) => f.followed_id)
    : [];

  const userIdsToFetch = [...followingIds, viewerId];

  const { data, error } = await supabase
    .from('stories')
    .select(STORY_SELECT)
    .in('user_id', userIdsToFetch)
    .gte('created_at', liveCutoff())
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(mapStoryRow);
};

/** One user's own live stories, newest first. */
export const getMyStories = async (userId: string): Promise<Story[]> => {
  const { data, error } = await supabase
    .from('stories')
    .select(STORY_SELECT)
    .eq('user_id', userId)
    .gte('created_at', liveCutoff())
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(mapStoryRow);
};

/** One story, if the signed-in user may see it: their own, or someone they follow. */
export const getStoryById = async (storyId: string, viewerId: ProfileId): Promise<Story | null> => {
  const { data: storyData, error } = await supabase
    .from('stories')
    .select(STORY_SELECT)
    .eq('id', storyId)
    .single();

  if (error || !storyData) {
    console.error('Error fetching story by id or story not found', error);
    return null;
  }

  if (viewerId === storyData.user_id) return mapStoryRow(storyData);

  const { count, error: followError } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('follower_id', viewerId)
    .eq('followed_id', storyData.user_id);

  if (followError) {
    console.error('Error checking follow status:', followError);
    return null; // Fail safe
  }

  return count && count > 0 ? mapStoryRow(storyData) : null;
};

/**
 * Upload a story as `authorId`: an image with an optional caption, or text on
 * its own.
 *
 * The media path is built from the auth user — storage RLS keys on
 * auth.uid() — and the row is attributed to the author profile. It used to
 * warn and fall back to the auth user whenever the two differed, which after
 * ONE-21 is every account's normal state.
 */
export const uploadStory = async (
  file: File | Blob | null,
  caption: string | null,
  authorId: ProfileId,
): Promise<Story> => {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new Error('User not authenticated');
  }

  const profileReady = await ensureProfileRowForUser(user);
  if (!profileReady) {
    throw new Error('Could not create or find a profile row for this account.');
  }

  let mediaUrl: string | null = null;
  if (file) {
    try {
      // Account-scoped: storage RLS keys the path on auth.uid(), not a profile.
      const { bucket, filePath } = await uploadStoryMedia(file, user.id);
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(filePath);
      if (!urlData) throw new Error('Could not get public URL for story.');
      mediaUrl = urlData.publicUrl;
    } catch (uploadError) {
      if (isLikelyStoragePolicyError(uploadError) || isStorageBucketMissingError(uploadError)) {
        console.warn('Story media upload skipped due storage policy/bucket constraints.', uploadError);
        try {
          mediaUrl = await blobToDataUrl(file);
        } catch (dataUrlError) {
          console.warn('Could not convert story media to inline data URL.', dataUrlError);
          mediaUrl = buildTextStoryDataUri(caption || 'Story');
        }
      } else {
        throw uploadError;
      }
    }
  }

  const insertStory = async (url: string | null) =>
    supabase
      .from('stories')
      .insert({ user_id: authorId, media_url: url, caption })
      .select(STORY_SELECT)
      .single();

  let { data: storyData, error: insertError } = await insertStory(mediaUrl);

  if (insertError && !file && insertError.code === '23502') {
    const retry = await insertStory(buildTextStoryDataUri(caption || ''));
    storyData = retry.data;
    insertError = retry.error;
  }

  if (insertError) throw insertError;
  return mapStoryRow(storyData);
};

export const deleteStoryFromDatabase = async (storyId: string): Promise<boolean> => {
  const { error } = await supabase.from('stories').delete().eq('id', storyId);
  return !error;
};

/** The ids of every story this user has liked. */
export const fetchLikedStoryIds = async (userId: string): Promise<string[]> => {
  const { data, error } = await supabase.from('story_likes').select('story_id').eq('user_id', userId);
  if (error) throw error;
  return (data || []).map((row: { story_id: string }) => row.story_id);
};

export const toggleStoryLikeInDatabase = async (storyId: string, userId: string): Promise<void> => {
  const { data: existingLike, error: likeError } = await supabase
    .from('story_likes')
    .select('*')
    .eq('story_id', storyId)
    .eq('user_id', userId)
    .maybeSingle();

  if (likeError) throw likeError;

  if (existingLike) {
    const { error } = await supabase.from('story_likes').delete().match({ story_id: storyId, user_id: userId });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('story_likes').insert({ story_id: storyId, user_id: userId });
    if (error) throw error;
  }
};

/** Record that this user saw a story. An upsert, so a second view is not a second row. */
export const recordStoryView = async (storyId: string, userId: string): Promise<void> => {
  const { error } = await supabase.from('story_views').upsert({ story_id: storyId, user_id: userId });
  if (error) throw error;
};

export const getStoryViewCount = async (storyId: string): Promise<number> => {
  const { count, error } = await supabase
    .from('story_views')
    .select('*', { count: 'exact', head: true })
    .eq('story_id', storyId);
  return error ? 0 : count || 0;
};

export const getStoryViewers = async (storyId: string): Promise<StoryViewer[]> => {
  const { data, error } = await supabase
    .from('story_views')
    .select(`
      user_id,
      profiles!user_id (
        username,
        avatar_url
      )
    `)
    .eq('story_id', storyId)
    .limit(50);

  if (error) {
    console.error('Error fetching story viewers:', error);
    return [];
  }

  return (data || []).map((row: any) => ({
    user_id: row.user_id,
    username: row.profiles?.username || 'unknown',
    avatar_url: row.profiles?.avatar_url || null,
  }));
};
