import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../store/AppContext.native';
import { useCurrentProfile } from '../features/profiles';
import { useUpdatePost } from '../features/posts';
import { fetchPostById as getPostById } from '../features/posts';
import { Avatar, Button, EmptyState, Skeleton } from '../components/native/ui';
import ComposeMedia from '../components/native/ComposeMedia';
import CharacterRing from '../components/native/CharacterRing';
import KeyboardAvoider from '../components/native/KeyboardAvoider';
import { POST_MAX_CHARS } from '../lib/screens/compose';
import { color, space, type } from '../theme/tokens';
import type { Post } from '../types';

/** What PostCard renders when a post carries no ratio. Kept in step with it. */
const FALLBACK_ASPECT_RATIO = 1080 / 1350;

export default function EditPostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { addToast } = useApp();
  const { profile: userProfile } = useCurrentProfile();
  const updatePost = useUpdatePost();

  const [post, setPost] = useState<Post | null>(null);
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const fetchPost = async () => {
      try {
        const data = await getPostById(id);
        if (data) {
          setPost(data);
          setContent(data.content || '');
        }
      } catch (error) {
        console.error('Failed to load post for editing', error);
        addToast('Failed to load post.', 'error');
      } finally {
        setLoading(false);
      }
    };
    fetchPost();
  }, [id]);

  const isOverLimit = content.length > POST_MAX_CHARS;
  const canSave = Boolean(post) && content.trim().length > 0 && !isSaving && content !== post?.content && !isOverLimit;

  // Stays on the screen, spinner showing, until the save resolves. It used to
  // fire the update, report success and close at once, so a failed save
  // looked exactly like a good one and the edit was lost.
  const handleSave = useCallback(async () => {
    if (!post || !canSave) return;
    setIsSaving(true);
    try {
      const updatedPost: Post = { ...post, content };
      await updatePost.mutateAsync(updatedPost);
      addToast('Post updated.', 'success');
      if (router.canGoBack()) {
        router.back();
      }
    } catch (error) {
      console.error('Failed to update post', error);
      addToast('Failed to update post.', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [post, content, canSave, updatePost, addToast, router]);

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
        <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
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

          {/* The text is editable; the photo is not. */}
          {post.media && post.media_type === 'image' ? (
            <View style={styles.media}>
              <ComposeMedia
                uri={post.media}
                aspectRatio={post.media_aspect_ratio || FALLBACK_ASPECT_RATIO}
              />
            </View>
          ) : null}

          {/* Under the draft, as in Compose, so it stays above the keyboard. */}
          <View style={styles.tools}>
            {content.length > 0 && <CharacterRing length={content.length} />}
          </View>
        </ScrollView>
      </KeyboardAvoider>
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
