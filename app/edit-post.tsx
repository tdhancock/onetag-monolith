import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Alert,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../store/AppContext.native';
import { profileKeys, useCurrentProfile } from '../features/profiles';
import { postKeys, useUpdatePost, usePostQuery } from '../features/posts';
import { embeddedTagWriter, tagKeys } from '../features/tags';
import { Avatar, Button, EmptyState, Skeleton } from '../components/native/ui';
import ComposeMedia from '../components/native/ComposeMedia';
import CharacterRing from '../components/native/CharacterRing';
import KeyboardAvoider from '../components/native/KeyboardAvoider';
import FormScrollView from '../components/native/FormScrollView';
import TagPlacer from '../components/native/TagPlacer';
import TagDestinationPicker from '../components/native/TagDestinationPicker';
import { POST_MAX_CHARS } from '../lib/screens/compose';
import {
  diffTags,
  hasTagEdits,
  isTagRefusal,
  moveTag,
  placeTag,
  previewTags,
  removeTag,
  saveTagEdits,
  seedDrafts,
  setTagDestination,
  TAG_REFUSED_MESSAGE,
  type DraftTag,
} from '../lib/screens/composeTags';
import { color, space, type } from '../theme/tokens';
import type { EmbeddedTag, EmbeddedTagDestination, Post } from '../types';

/** What PostCard renders when a post carries no ratio. Kept in step with it. */
const FALLBACK_ASPECT_RATIO = 1080 / 1350;

export default function EditPostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { addToast } = useApp();
  const queryClient = useQueryClient();
  const { profile: userProfile, profileId } = useCurrentProfile();
  const updatePost = useUpdatePost();

  // The post as last saved: what the caption and tags are compared with.
  // It starts as the post read from the cache.
  const [post, setPost] = useState<Post | null>(null);
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // The photo's tags (ONE-92): what the post holds on the server, and the
  // drafts the placer edits. Saving writes the difference, and moves `saved`
  // along as each step lands.
  const [savedTags, setSavedTags] = useState<EmbeddedTag[]>([]);
  const [tags, setTags] = useState<DraftTag[]>([]);
  const [tagging, setTagging] = useState(false);
  /** The tag whose destination picker is open. */
  const [pickingFor, setPickingFor] = useState<string | null>(null);

  // The form starts from the post as the server has it, never from a copy
  // a list was holding: saving compares against it. Seeded once, so a
  // refetch doesn't overwrite what is being typed.
  const postQuery = usePostQuery(id, profileId);
  const settled = postQuery.isError || (postQuery.isSuccess && !postQuery.isPlaceholderData);
  const fetched = settled ? postQuery.data : undefined;
  // Until the form is seeded from it, too, or it would flash as missing.
  const loading = !settled || (Boolean(fetched) && !post);
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !fetched) return;
    seeded.current = true;
    setPost(fetched);
    setContent(fetched.content || '');
    setSavedTags(fetched.embeddedTags ?? []);
    setTags(seedDrafts(fetched.embeddedTags ?? []));
  }, [fetched]);

  useEffect(() => {
    if (!postQuery.isError) return;
    console.error('Failed to load post for editing', postQuery.error);
    addToast('Failed to load post.', 'error');
  }, [postQuery.isError, postQuery.error, addToast]);

  // Only your own photo post is tagged here: a text post has nothing to tag,
  // and a tag belongs to the post's author.
  const canTag = Boolean(
    post?.media && post.media_type === 'image' && profileId && post.username === userProfile?.username,
  );

  const isOverLimit = content.length > POST_MAX_CHARS;
  const captionChanged = Boolean(post) && content !== post?.content;
  const tagsChanged = useMemo(() => canTag && hasTagEdits(diffTags(savedTags, tags)), [canTag, savedTags, tags]);
  const canSave =
    Boolean(post) &&
    !isSaving &&
    !isOverLimit &&
    (captionChanged || tagsChanged) &&
    // A changed caption can't be emptied; an unchanged one is left as it is.
    (!captionChanged || content.trim().length > 0);

  const handlePlaceTag = (xPct: number, yPct: number) => {
    const placed = placeTag(tags, xPct, yPct);
    if (!placed.ok) {
      Alert.alert('That’s the limit', placed.message);
      return;
    }
    setTags(placed.drafts);
    setPickingFor(placed.key);
  };

  const handlePickDestination = (destination: EmbeddedTagDestination) => {
    if (pickingFor) setTags((current) => setTagDestination(current, pickingFor, destination));
    setPickingFor(null);
  };

  // Closed without a choice: a newly placed tag with nowhere to point goes.
  const handleClosePicker = () => {
    setTags((current) => current.filter((t) => t.key !== pickingFor || t.destination !== null));
    setPickingFor(null);
  };

  // Stays on the screen, spinner showing, until the save resolves. It used to
  // fire the update, report success and close at once, so a failed save
  // looked exactly like a good one and the edit was lost.
  //
  // One Save for caption and tags (ONE-92). A tag step that fails leaves
  // `savedTags` at what the server holds, so saving again picks up where it
  // stopped.
  const handleSave = useCallback(async () => {
    if (!post || !canSave) return;
    setIsSaving(true);
    try {
      if (captionChanged) {
        const updatedPost: Post = { ...post, content };
        await updatePost.mutateAsync(updatedPost);
        setPost(updatedPost);
      }
      if (tagsChanged && profileId) {
        await saveTagEdits(savedTags, tags, embeddedTagWriter(post.id, profileId), (saved, drafts) => {
          setSavedTags(saved);
          setTags(drafts);
        });
      }
      addToast('Post updated.', 'success');
      if (router.canGoBack()) {
        router.back();
      }
    } catch (error) {
      console.error('Failed to update post', error);
      addToast(isTagRefusal(error) ? TAG_REFUSED_MESSAGE : 'Failed to update post.', 'error');
    } finally {
      setIsSaving(false);
      // The post and every list that embeds it show its tags, whichever steps
      // landed, and so does the author's Tags dashboard.
      if (tagsChanged) {
        void queryClient.invalidateQueries({ queryKey: postKeys.all });
        void queryClient.invalidateQueries({ queryKey: profileKeys.all });
        void queryClient.invalidateQueries({ queryKey: tagKeys.lists() });
      }
    }
  }, [post, content, canSave, captionChanged, tagsChanged, profileId, savedTags, tags, updatePost, addToast, router, queryClient]);

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        hitSlop={12}
        style={styles.headerSide}
      >
        <Text style={styles.cancel}>Cancel</Text>
      </Pressable>
      <Text style={styles.title} accessibilityRole="header">
        Edit post
      </Text>
      <View style={[styles.headerSide, styles.headerRight]}>
        {post ? (
          <Button size="sm" onPress={handleSave} disabled={!canSave && !isSaving} loading={isSaving}>
            Save
          </Button>
        ) : null}
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        {header}
        <View style={styles.body}>
          <Skeleton circle height={40} />
          <View style={styles.skeletonLines}>
            <Skeleton height={14} />
            <Skeleton width="70%" height={14} style={styles.skeletonGap} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        {header}
        <EmptyState
          title="This post isn't available"
          body="It may have been deleted."
          action={{ label: 'Back', onPress: () => router.back() }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      {header}

      <KeyboardAvoider style={styles.fill}>
        <FormScrollView style={styles.fill} contentContainerStyle={styles.scroll}>
          <View style={styles.body}>
            <Avatar
              uri={userProfile?.profilePicture}
              name={userProfile?.name || userProfile?.username}
              size={40}
            />
            <TextInput
              value={content}
              onChangeText={setContent}
              placeholder="What's happening?"
              placeholderTextColor={color.textMuted}
              selectionColor={color.text}
              style={styles.input}
              multiline
              autoFocus
              maxLength={POST_MAX_CHARS + 50}
              accessibilityLabel="Post text"
            />
          </View>

          {/* The text and the tags are editable; the photo is not. */}
          {post.media && post.media_type === 'image' ? (
            <View style={styles.media}>
              {tagging && canTag ? (
                <TagPlacer
                  uri={post.media}
                  aspectRatio={post.media_aspect_ratio || FALLBACK_ASPECT_RATIO}
                  tags={tags}
                  onPlace={handlePlaceTag}
                  onMove={(key, x, y) => setTags((current) => moveTag(current, key, x, y))}
                  onRemove={(key) => setTags((current) => removeTag(current, key))}
                  onChoose={setPickingFor}
                />
              ) : (
                <ComposeMedia
                  uri={post.media}
                  aspectRatio={post.media_aspect_ratio || FALLBACK_ASPECT_RATIO}
                  tags={previewTags(tags)}
                />
              )}
            </View>
          ) : null}

          {/* Under the draft, as in Compose, so it stays above the keyboard. */}
          <View style={styles.tools}>
            {canTag && (
              <Button
                size="sm"
                variant={tagging ? 'primary' : 'outline'}
                onPress={() => setTagging((on) => !on)}
                accessibilityLabel={tagging ? 'Done tagging' : 'Tag profiles, products or projects in this photo'}
              >
                {tagging ? 'Done' : 'Tag'}
              </Button>
            )}
            <View style={styles.fill} />
            {content.length > 0 && <CharacterRing length={content.length} />}
          </View>
        </FormScrollView>
      </KeyboardAvoider>

      <TagDestinationPicker
        visible={pickingFor !== null}
        onPick={handlePickDestination}
        onClose={handleClosePicker}
        hostPostId={post?.id}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  fill: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  headerSide: {
    minWidth: 72,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  cancel: {
    fontFamily: type.body,
    fontSize: 16,
    color: color.text,
  },
  title: {
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
  },
  scroll: {
    paddingBottom: space.lg,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.lg,
  },
  skeletonLines: {
    flex: 1,
    paddingTop: space.sm,
  },
  skeletonGap: {
    marginTop: space.sm,
  },
  input: {
    flex: 1,
    minHeight: 40,
    paddingTop: space.sm,
    fontFamily: type.body,
    fontSize: 17,
    lineHeight: 24,
    color: color.text,
    textAlignVertical: 'top',
  },
  media: {
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: 44,
    paddingHorizontal: space.lg,
  },
});
