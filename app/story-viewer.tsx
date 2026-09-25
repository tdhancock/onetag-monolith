

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  Dimensions,
  Animated,
  PanResponder,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
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
import UserAvatar from '../components/native/UserAvatar';
import { HeartIcon, XIcon, TrashIcon, EyeIcon, SendIcon } from '../components/native/Icons';
import type { Story } from '../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const STORY_DURATION = 15000;
const SWIPE_THRESHOLD = 60;

const GRADIENT_COLORS = [
  ['#1e3a5f', '#0f172a'],
  ['#4a1942', '#1a0a2e'],
  ['#1a3c34', '#0a1628'],
  ['#3d1f00', '#1a0e00'],
  ['#2d1b4e', '#0e0a1a'],
] as const;

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
  const { profile: userProfile, profileId } = useCurrentProfile();

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
      onSuccess: () => addToast('Story deleted.', 'info'),
      onError: (error) => {
        console.error('Failed to delete story:', error);
        addToast('Could not delete story.', 'error');
      },
    });
    setStories(prev => prev.filter(s => s.id !== currentStory.id));
    if (stories.length <= 1) {
      router.back();
    } else if (currentIndex >= stories.length - 1) {
      setCurrentIndex(prev => Math.max(0, prev - 1));
    }
  }, [currentStory, triggerHapticFeedback, deleteStory, addToast, stories.length, currentIndex, router]);

  // Loading
  if (loading) {
    return (
      <View className="flex-1 bg-black justify-center items-center">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color="#3b82f6" size="large" />
      </View>
    );
  }

  // No stories
  if (!currentStory || stories.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-black justify-center items-center">
        <Stack.Screen options={{ headerShown: false }} />
        <Text className="text-gray-400 text-lg">No stories to show.</Text>
        <Pressable onPress={() => router.back()} className="mt-4">
          <Text className="text-blue-500">Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const gradientPair = GRADIENT_COLORS[currentIndex % GRADIENT_COLORS.length];
  const isTextStory = !currentStory.imageUrl;

  return (
    <Animated.View
      style={{
        flex: 1,
        backgroundColor: '#000',
        opacity: opacityAnim,
        transform: [{ translateX }, { translateY }],
      }}
    >
      <Stack.Screen options={{ headerShown: false, presentation: 'fullScreenModal' }} />

      <View style={{ flex: 1 }} {...panResponder.panHandlers}>
        {/* Story content */}
        {isTextStory ? (
          <LinearGradient
            colors={[...gradientPair]}
            style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}
          >
            <Text className="text-white text-2xl font-bold text-center" style={{ lineHeight: 36 }}>
              {currentStory.content}
            </Text>
          </LinearGradient>
        ) : (
          <Image
            source={{ uri: currentStory.imageUrl }}
            style={{ flex: 1 }}
            contentFit="cover"
            transition={200}
          />
        )}

        {/* Top gradient */}
        <LinearGradient
          colors={['rgba(0,0,0,0.7)', 'transparent']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 160 }}
        />

        {/* Bottom gradient */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.7)']}
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 200 }}
        />

        {/* Header */}
        <SafeAreaView edges={['top']} className="absolute top-0 left-0 right-0 z-20">
          {/* Progress bars */}
          <View className="flex-row px-2 pt-2" style={{ gap: 3 }}>
            {stories.map((_, i) => (
              <View key={i} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
                {i < currentIndex ? (
                  <View className="flex-1 bg-white" />
                ) : i === currentIndex ? (
                  <Animated.View
                    style={{
                      height: '100%',
                      backgroundColor: 'white',
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    }}
                  />
                ) : null}
              </View>
            ))}
          </View>

          {/* User info row */}
          <View className="flex-row items-center px-4 mt-3" style={{ gap: 10 }}>
            <Pressable
              onPress={() => {
                router.back();
                setTimeout(() => router.push(`/user/${currentStory.username}`), 100);
              }}
            >
              <UserAvatar
                username={currentStory.username}
                avatarUrl={currentStory.avatar || undefined}
                size={36}
              />
            </Pressable>
            <Text className="text-white font-semibold flex-1">
              @{currentStory.username}
            </Text>

            {isPaused && (
              <Text className="text-white/60 text-xs mr-2">PAUSED</Text>
            )}

            <Pressable onPress={handleClose} className="p-1">
              <XIcon color="white" size={24} />
            </Pressable>
          </View>
        </SafeAreaView>

        {/* Footer */}
        <SafeAreaView edges={['bottom']} className="absolute bottom-0 left-0 right-0 z-20">
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {isOwnStory ? (
              <View className="px-6 pb-4">
                <View className="flex-row items-center justify-between mb-3">
                  <Pressable
                    className="flex-row items-center"
                    style={{ gap: 6 }}
                    onPress={() => {
                      if (viewers.length > 0) {
                        router.push({
                          pathname: '/user-list',
                          params: { type: 'storyViews', storyId: currentStory.id, title: 'Story Views' },
                        });
                      }
                    }}
                  >
                    <EyeIcon color="white" size={20} />
                    <Text className="text-white font-semibold">
                      {viewCount !== null ? `${viewCount} view${viewCount !== 1 ? 's' : ''}` : '...'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={handleDelete} className="p-2">
                    <TrashIcon color="#ef4444" size={22} />
                  </Pressable>
                </View>

                {/* Viewer avatars row */}
                {viewers.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="pb-1">
                    {viewers.slice(0, 20).map((viewer) => (
                      <Pressable
                        key={viewer.user_id}
                        onPress={() => router.push(`/user/${viewer.username}`)}
                        className="mr-2"
                      >
                        <UserAvatar
                          username={viewer.username}
                          avatarUrl={viewer.avatar_url || undefined}
                          size={32}
                        />
                      </Pressable>
                    ))}
                    {viewers.length > 20 && (
                      <View className="w-8 h-8 rounded-full bg-gray-700 items-center justify-center">
                        <Text className="text-white text-xs">
                          +{viewers.length - 20}
                        </Text>
                      </View>
                    )}
                  </ScrollView>
                )}
              </View>
            ) : (
              <View className="flex-row items-center px-4 pb-4" style={{ gap: 12 }}>
                <View className="flex-1 flex-row items-center bg-white/10 rounded-full px-4">
                  <TextInput
                    value={replyText}
                    onChangeText={setReplyText}
                    placeholder="Send a reply..."
                    placeholderTextColor="rgba(255,255,255,0.5)"
                    className="flex-1 text-white py-2.5"
                    returnKeyType="send"
                    onSubmitEditing={handleReply}
                    onFocus={() => setIsPaused(true)}
                    onBlur={() => setIsPaused(false)}
                  />
                  {replyText.trim() ? (
                    <Pressable onPress={handleReply} className="ml-2">
                      <SendIcon color="#3b82f6" size={20} />
                    </Pressable>
                  ) : null}
                </View>
                <Pressable onPress={handleLike}>
                  <HeartIcon color={liked ? '#ef4444' : 'white'} size={26} liked={liked} />
                </Pressable>
              </View>
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Animated.View>
  );
}
