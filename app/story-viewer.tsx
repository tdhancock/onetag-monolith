import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  Dimensions,
  Animated,
  PanResponder,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '../store/AppContext.native';
import { useCurrentProfile } from '../features/profiles';
import {
  useStoriesQuery,
  useMyStoriesQuery,
  useStoryViewCountQuery,
  useStoryViewersQuery,
  useIsStoryLiked,
  useToggleStoryLike,
  useDeleteStory,
  useRecordStoryView,
  useReplyToStory,
} from '../features/stories';
import { Avatar, EmptyState, IconButton, ListRow, MonoLabel, TextField } from '../components/native/ui';
import { HeartIcon, XIcon, TrashIcon, EyeIcon, SendIcon } from '../components/native/Icons';
import { gradientFor } from '../lib/oneSnaps';
import { getTimeAgo } from '../lib/timeAgo';
import { color, radius, space, type, withAlpha } from '../theme/tokens';
import type { Story } from '../types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const STORY_DURATION = 15000;
const SWIPE_THRESHOLD = 60;

// The viewer stays dark for the content's sake. Its black is the ink token,
// and everything laid over the media is inverse, at full or partial strength.
const MEDIA_GROUND = color.text;
const SCRIM = withAlpha(color.text, 0.7);
const SCRIM_CLEAR = withAlpha(color.text, 0);
const PROGRESS_PENDING = withAlpha(color.inverse, 0.4);
const INVERSE_MUTED = withAlpha(color.inverse, 0.7);

export default function StoryViewerScreen() {
  const router = useRouter();
  const { index: startIndexParam, storyId: startStoryIdParam } = useLocalSearchParams<{ index?: string; storyId?: string }>();
  const {
    markStoryAsViewed,
    setIsViewingStory,
    isUserBlocked,
    triggerHapticFeedback,
    addToast,
  } = useApp();
  const { profileId } = useCurrentProfile();

  const userId = profileId;

  // The reel and "Your story" are queries (ONE-19). The viewer takes one
  // snapshot of them when it opens, below, so a realtime insert cannot shift
  // the story under the user's thumb mid-playback.
  const reelQuery = useStoriesQuery(userId);
  const myStoriesQuery = useMyStoriesQuery(userId);

  const isStoryLiked = useIsStoryLiked(userId);
  const storyLike = useToggleStoryLike(userId);
  const deleteStory = useDeleteStory();
  const recordView = useRecordStoryView(userId);
  const replyToStory = useReplyToStory(userId);

  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [replyText, setReplyText] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<Animated.CompositeAnimation | null>(null);

  const currentStory = stories[currentIndex];
  const isOwnStory = currentStory?.userId === profileId;
  const liked = currentStory ? isStoryLiked(currentStory.id) : false;

  // Only the owner sees who viewed a story.
  const { data: viewCount = null } = useStoryViewCountQuery(currentStory?.id, isOwnStory);
  const { data: viewers = [] } = useStoryViewersQuery(currentStory?.id, isOwnStory);

  const dedupeStories = useCallback((input: Story[]) => {
    const seen = new Set<string>();
    const unique: Story[] = [];
    for (const story of input) {
      if (!story?.id || seen.has(story.id)) continue;
      seen.add(story.id);
      unique.push(story);
    }
    return unique;
  }, []);

  // Snapshot the stories once both queries have settled.
  const snapshotTaken = useRef(false);
  const queriesSettled =
    !userId || (!reelQuery.isPending && !myStoriesQuery.isPending);

  useEffect(() => {
    if (snapshotTaken.current || !queriesSettled) return;
    snapshotTaken.current = true;

    if (reelQuery.isError) console.error('Failed to load stories', reelQuery.error);

    const merged = dedupeStories([...(myStoriesQuery.data ?? []), ...(reelQuery.data ?? [])]);
    const combined = merged.filter(s => !isUserBlocked(s.username));
    setStories(combined);

    let startIdx = parseInt(startIndexParam || '0', 10);
    if (startStoryIdParam) {
      const byIdIndex = combined.findIndex(story => story.id === startStoryIdParam);
      if (byIdIndex >= 0) {
        startIdx = byIdIndex;
      }
    }
    setCurrentIndex(Math.min(Math.max(startIdx, 0), Math.max(0, combined.length - 1)));
    setLoading(false);
  }, [queriesSettled, reelQuery.data, myStoriesQuery.data, reelQuery.isError, reelQuery.error, isUserBlocked, startIndexParam, startStoryIdParam, dedupeStories]);

  // Mark as viewing
  useEffect(() => {
    setIsViewingStory(true);
    return () => setIsViewingStory(false);
  }, [setIsViewingStory]);

  // Mark viewed on this device, and record the view for the owner. The
  // record never blocks playback and never toasts: useRecordStoryView
  // swallows its own failure.
  useEffect(() => {
    if (!currentStory) return;
    markStoryAsViewed(currentStory.timestamp);
    if (!isOwnStory) recordView(currentStory.id);
  }, [currentIndex, currentStory?.id]);

  // Navigation
  const goNext = useCallback(() => {
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      router.back();
    }
  }, [currentIndex, stories.length, router]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  }, [currentIndex]);

  // Auto-advance timer
  const startTimer = useCallback(() => {
    progressAnim.setValue(0);
    timerRef.current?.stop();

    const anim = Animated.timing(progressAnim, {
      toValue: 1,
      duration: STORY_DURATION,
      useNativeDriver: false,
    });
    timerRef.current = anim;
    anim.start(({ finished }) => {
      if (finished) goNext();
    });
  }, [progressAnim, goNext]);

  useEffect(() => {
    if (!isPaused && stories.length > 0 && !loading) {
      startTimer();
    }
    return () => timerRef.current?.stop();
  }, [currentIndex, isPaused, startTimer, loading]);

  const handleClose = useCallback(() => {
    Animated.timing(opacityAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => router.back());
  }, [router, opacityAnim]);

  // Tap zones
  const handleTap = useCallback(
    (x: number) => {
      const leftZone = SCREEN_WIDTH * 0.3;
      const rightZone = SCREEN_WIDTH * 0.7;

      if (x < leftZone) {
        goPrev();
      } else if (x > rightZone) {
        goNext();
      } else {
        setIsPaused(prev => !prev);
      }
    },
    [goPrev, goNext],
  );

  const resetPosition = useCallback(() => {
    Animated.parallel([
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  }, [translateX, translateY]);

  // Pan gesture
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 10 || Math.abs(gs.dy) > 10,
      onPanResponderGrant: () => {
        setIsPaused(true);
      },
      onPanResponderMove: (_, gs) => {
        if (Math.abs(gs.dy) > Math.abs(gs.dx)) {
          translateY.setValue(gs.dy);
        } else {
          translateX.setValue(gs.dx);
        }
      },
      onPanResponderRelease: (evt, gs) => {
        const moved = Math.abs(gs.dx) > 10 || Math.abs(gs.dy) > 10;

        if (!moved) {
          handleTap(evt.nativeEvent.pageX);
          setIsPaused(false);
          resetPosition();
          return;
        }

        if (gs.dy > SWIPE_THRESHOLD) {
          handleClose();
          return;
        }

        if (Math.abs(gs.dx) > SWIPE_THRESHOLD) {
          if (gs.dx < 0) goNext();
          else goPrev();
        }

        setIsPaused(false);
        resetPosition();
      },
      onPanResponderTerminate: () => {
        setIsPaused(false);
        resetPosition();
      },
    }),
  ).current;

  const handleLike = useCallback(() => {
    if (!currentStory) return;
    triggerHapticFeedback('medium');
    storyLike.toggle(currentStory.id);
  }, [currentStory, triggerHapticFeedback, storyLike]);

  const handleReply = useCallback(async () => {
    if (!replyText.trim() || !currentStory || !profileId) return;
    try {
      await replyToStory.mutateAsync({ story: currentStory, text: replyText.trim() });
      addToast('Reply sent!', 'success');
      setReplyText('');
    } catch {
      addToast('Failed to send reply.', 'error');
    }
  }, [replyText, currentStory, profileId, addToast, replyToStory]);

  const handleDelete = useCallback(() => {
    if (!currentStory) return;
    triggerHapticFeedback('heavy');
    deleteStory.mutate(currentStory.id, {
      onSuccess: () => addToast('OneSnap deleted.', 'info'),
      onError: (error) => {
        console.error('Failed to delete story:', error);
        addToast('Could not delete OneSnap.', 'error');
      },
    });
    setStories(prev => prev.filter(s => s.id !== currentStory.id));
    if (stories.length <= 1) {
      router.back();
    } else if (currentIndex >= stories.length - 1) {
      setCurrentIndex(prev => Math.max(0, prev - 1));
    }
  }, [currentStory, triggerHapticFeedback, deleteStory, addToast, stories.length, currentIndex, router]);

  // The owner's "Seen by" sheet holds playback while it is open.
  const openViewers = useCallback(() => {
    if (viewers.length === 0) return;
    setIsPaused(true);
    setViewersOpen(true);
  }, [viewers.length]);

  const closeViewers = useCallback(() => {
    setViewersOpen(false);
    setIsPaused(false);
  }, []);

  // Loading
  if (loading) {
    return (
      <View style={[styles.fill, styles.centred, { backgroundColor: MEDIA_GROUND }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar style="light" />
        <ActivityIndicator color={color.inverse} size="large" />
      </View>
    );
  }

  // Nothing to play: not content, so it sits on the light ground.
  if (!currentStory || stories.length === 0) {
    return (
      <SafeAreaView style={[styles.fill, styles.centred, { backgroundColor: color.bg }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar style="dark" />
        <EmptyState
          title="No OneSnaps to show"
          body="The OneSnaps here have expired or been removed."
          action={{ label: 'Go back', onPress: () => router.back() }}
        />
      </SafeAreaView>
    );
  }

  const isTextStory = !currentStory.imageUrl;
  const seenBy = viewCount ?? viewers.length;
  const timeAgo = getTimeAgo(currentStory.timestamp);

  return (
    <Animated.View
      style={{
        flex: 1,
        backgroundColor: MEDIA_GROUND,
        opacity: opacityAnim,
        transform: [{ translateX }, { translateY }],
      }}
    >
      <Stack.Screen options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      <StatusBar style="light" />

      <View style={styles.fill} {...panResponder.panHandlers}>
        {/* OneSnap content */}
        {isTextStory ? (
          <LinearGradient colors={[...gradientFor(currentStory)]} style={styles.textStory}>
            <Text style={styles.textStoryCopy}>{currentStory.content}</Text>
          </LinearGradient>
        ) : (
          <Image
            source={{ uri: currentStory.imageUrl }}
            style={styles.fill}
            contentFit="cover"
            transition={200}
          />
        )}

        {/* Scrims so the chrome reads over any image */}
        <LinearGradient colors={[SCRIM, SCRIM_CLEAR]} style={styles.topScrim} />
        <LinearGradient colors={[SCRIM_CLEAR, SCRIM]} style={styles.bottomScrim} />

        {/* Header */}
        <SafeAreaView edges={['top']} style={styles.header}>
          {/* Progress: one 2pt segment per OneSnap */}
          <View style={styles.progressRow}>
            {stories.map((_, i) => (
              <View key={i} style={styles.progressTrack}>
                {i < currentIndex ? (
                  <View style={[styles.fill, styles.progressFill]} />
                ) : i === currentIndex ? (
                  <Animated.View
                    style={[
                      styles.progressFill,
                      {
                        height: '100%',
                        width: progressAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0%', '100%'],
                        }),
                      },
                    ]}
                  />
                ) : null}
              </View>
            ))}
          </View>

          {/* Author */}
          <View style={styles.authorRow}>
            <Pressable
              style={styles.author}
              accessibilityRole="button"
              accessibilityLabel={`View ${currentStory.username}'s profile`}
              onPress={() => {
                router.back();
                setTimeout(() => router.push(`/user/${currentStory.username}`), 100);
              }}
            >
              <Avatar uri={currentStory.avatar} name={currentStory.username} size={32} />
              <View style={styles.authorText}>
                <Text style={styles.authorName} numberOfLines={1}>
                  {currentStory.username}
                </Text>
                {timeAgo ? <Text style={styles.authorTime}>{timeAgo}</Text> : null}
              </View>
            </Pressable>

            {isPaused && (
              <MonoLabel color="inverse" style={styles.paused}>
                Paused
              </MonoLabel>
            )}

            <IconButton
              icon={<XIcon color={color.inverse} size={24} />}
              accessibilityLabel="Close"
              onPress={handleClose}
            />
          </View>
        </SafeAreaView>

        {/* Footer */}
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {isOwnStory ? (
              <View style={styles.ownerRow}>
                <Pressable
                  style={styles.seenBy}
                  onPress={openViewers}
                  disabled={viewers.length === 0}
                  accessibilityRole="button"
                  accessibilityLabel={viewCount !== null ? `Seen by ${seenBy}` : 'Loading views'}
                >
                  <EyeIcon color={color.inverse} size={20} />
                  <Text style={styles.seenByText}>
                    {viewCount !== null ? `Seen by ${seenBy}` : '…'}
                  </Text>
                </Pressable>
                <IconButton
                  icon={<TrashIcon color={color.inverse} size={22} />}
                  accessibilityLabel="Delete OneSnap"
                  onPress={handleDelete}
                />
              </View>
            ) : (
              <View style={styles.replyRow}>
                <TextField
                  variant="overlay"
                  value={replyText}
                  onChangeText={setReplyText}
                  placeholder="Send a reply…"
                  returnKeyType="send"
                  onSubmitEditing={handleReply}
                  onFocus={() => setIsPaused(true)}
                  onBlur={() => setIsPaused(false)}
                  containerStyle={styles.replyField}
                />
                <IconButton
                  icon={<SendIcon color={color.inverse} size={22} />}
                  accessibilityLabel="Send reply"
                  disabled={!replyText.trim()}
                  onPress={handleReply}
                />
                <IconButton
                  icon={
                    <HeartIcon
                      liked={liked}
                      color={liked ? color.heart : color.inverse}
                      size={26}
                    />
                  }
                  accessibilityLabel={`Like, ${liked ? 'liked' : 'not liked'}`}
                  onPress={handleLike}
                />
              </View>
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>

      {/* The owner's viewer list */}
      <Modal visible={viewersOpen} transparent animationType="slide" onRequestClose={closeViewers}>
        <View style={styles.sheetRoot}>
          <Pressable
            style={[StyleSheet.absoluteFill, styles.sheetScrim]}
            onPress={closeViewers}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Seen by {seenBy}</Text>
              <IconButton
                icon={<XIcon color={color.text} size={20} />}
                accessibilityLabel="Close"
                onPress={closeViewers}
              />
            </View>
            <FlatList
              data={viewers}
              keyExtractor={viewer => viewer.user_id}
              renderItem={({ item: viewer }) => (
                <ListRow
                  title={viewer.username}
                  avatarUri={viewer.avatar_url}
                  accessibilityLabel={`View ${viewer.username}'s profile`}
                  onPress={() => {
                    closeViewers();
                    router.push(`/user/${viewer.username}`);
                  }}
                />
              )}
              style={styles.sheetList}
            />
          </SafeAreaView>
        </View>
      </Modal>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Content
  textStory: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
  },
  textStoryCopy: {
    fontFamily: type.bodyBold,
    fontSize: 24,
    lineHeight: 36,
    color: color.inverse,
    textAlign: 'center',
  },
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 160,
  },
  bottomScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 200,
  },

  // Header
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  progressRow: {
    flexDirection: 'row',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingTop: space.sm,
  },
  progressTrack: {
    flex: 1,
    height: 2,
    overflow: 'hidden',
    backgroundColor: PROGRESS_PENDING,
  },
  progressFill: {
    backgroundColor: color.inverse,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.lg,
    paddingRight: space.xs,
    marginTop: space.sm,
  },
  author: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  authorText: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    marginLeft: space.sm,
    gap: space.sm,
  },
  authorName: {
    flexShrink: 1,
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.inverse,
  },
  authorTime: {
    fontFamily: type.body,
    fontSize: 13,
    color: INVERSE_MUTED,
  },
  paused: {
    marginRight: space.sm,
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: space.lg,
    paddingRight: space.xs,
    paddingBottom: space.md,
  },
  seenBy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
  },
  seenByText: {
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.inverse,
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.lg,
    paddingRight: space.xs,
    paddingBottom: space.md,
  },
  replyField: {
    flex: 1,
    marginRight: space.xs,
  },

  // Viewer sheet
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetScrim: {
    backgroundColor: color.text,
    opacity: 0.4,
  },
  sheet: {
    maxHeight: SCREEN_HEIGHT * 0.6,
    backgroundColor: color.bg,
    borderTopWidth: 1,
    borderTopColor: color.border,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: space.lg,
    paddingRight: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  sheetTitle: {
    fontFamily: type.bodyBold,
    fontSize: 17,
    color: color.text,
  },
  sheetList: {
    flexGrow: 0,
  },
});
