

import React, { createContext, useContext, useState, ReactNode, useCallback, useMemo, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useBlockedUsers, useBlockToggle, migrateLocalBlocks, blockKeys } from '../features/blocks';
import { publishPost, deletePost, updatePost, addComment as apiAddComment, getFollowingList, unfollowUser, followUser, markNotificationsAsRead, getMyStories, deleteStoryFromDatabase, toggleStoryLikeInDatabase, markMessagesAsRead as apiMarkMessagesAsRead, adminDeletePost, ensureCurrentUserProfile, MediaUploadError } from '../services/apiService';
import { supabase } from '../services/supabase.native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import type { Comment, Post, Story, UserProfile, Toast, Notification, Message } from '../types';
import { normalizeNotifications } from '../types';

interface AppState {
    postComments: Map<string, Comment[]>;
    profilePosts: Post[];
    userProfile: UserProfile;
    theme: 'light' | 'dark';
    userStories: Story[];
    storyComments: Map<string, Comment[]>;
    likedStoryIds: Set<string>;
    hasNewStory: boolean;
    viewedStoryTimestamps: Set<string>;
    isViewingStory: boolean;
    likedVideoIds: Set<string>;
    followedUsernames: Set<string>;
    votedPolls: Map<string, number>;
    toasts: Toast[];
    tooltip: { text: string } | null;
    notifications: Notification[] | null;
    unreadMessageCount: number;
    unreadChats: Set<string>;
    topNotification: { title: string; message: string } | null;
    isAdmin: boolean;
}

interface AppContextType extends AppState {
    postComment: (postId: string, content: string) => Promise<void>;
    getComments: (postId: string) => Comment[];
    setComments: (postId: string, comments: Comment[]) => void;
    areCommentsLoaded: (postId: string) => boolean;
    // Rejects when the post could not be published — the composer relies on
    // that to keep the draft on screen. See ONE-56.
    addProfilePost: (post: Post) => Promise<void>;
    deleteProfilePost: (postId: string) => void;
    updateProfilePost: (updatedPost: Post) => void;
    setProfilePosts: (posts: Post[]) => void;
    updateProfile: (newProfile: Partial<UserProfile>) => void;
    setTheme: (theme: 'light' | 'dark') => void;
    addUserStory: (story: Story) => void;
    deleteStory: (storyId: string) => void;
    markStoriesViewed: () => void;
    isStoryLiked: (storyId: string) => boolean;
    toggleStoryLike: (story: Story) => Promise<void>;
    getStoryComments: (storyId: string) => Comment[];
    addStoryComment: (storyId: string, comment: Comment) => void;
    setStoryComments: (storyId: string, comments: Comment[]) => void;
    markStoryAsViewed: (timestamp: string) => void;
    isStoryViewed: (timestamp: string) => boolean;
    setIsViewingStory: (isViewing: boolean) => void;
    toggleBlockUser: (username: string) => void;
    isUserBlocked: (username: string) => boolean;
    toggleVideoLike: (videoId: string) => void;
    isVideoLiked: (videoId: string) => boolean;
    toggleFollowUser: (username: string) => Promise<void>;
    isUserFollowed: (username: string) => boolean;
    voteInPoll: (postId: string, optionIndex: number) => void;
    getPollVote: (postId: string) => number | undefined;
    addToast: (message: string, type?: Toast['type']) => void;
    removeToast: (id: string) => void;
    showTopNotification: (title: string, message: string) => void;
    triggerHapticFeedback: (style?: 'light' | 'medium' | 'heavy') => void;
    setTooltip: (tooltip: { text: string } | null) => void;
    refreshAllData: () => Promise<void>;
    markAllNotificationsAsRead: (userId?: string) => Promise<void>;
    markAllMessagesAsRead: () => Promise<void>;
    markChatAsRead: (senderId: string) => Promise<void>;
    replaceStory: (localId: string, realStory: Story) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [state, setState] = useState<AppState>(() => {
        return {
            postComments: new Map(),
            profilePosts: [],
            userProfile: {
                id: '',
                name: 'OneTag User',
                username: 'onetag_user',
                bio: 'Hello, I am using OneTag',
                profilePicture: null,
            },
            theme: 'dark',
            userStories: [],
            storyComments: new Map(),
            likedStoryIds: new Set(),
            hasNewStory: false,
            viewedStoryTimestamps: new Set(),
            isViewingStory: false,
            likedVideoIds: new Set(),
            followedUsernames: new Set(),
            votedPolls: new Map(),
            toasts: [],
            tooltip: null,
            notifications: null,
            unreadMessageCount: 0,
            unreadChats: new Set(),
            topNotification: null,
            isAdmin: false,
        };
    });

    const queryClient = useQueryClient();

    // Blocking lives on the server now (ONE-54). The list is a query, and
    // `isUserBlocked` reads from it rather than from AppState — a block that
    // only this device knows about is not a block.
    const blocks = useBlockedUsers(state.userProfile.id || undefined);
    const blockToggle = useBlockToggle(state.userProfile.id || undefined);

    // One-time migration of the device-local list (ONE-54). The logic lives
    // in features/blocks so the tests drive the same code this does.
    useEffect(() => {
        const blockerId = state.userProfile.id;
        if (!blockerId) return;

        migrateLocalBlocks(AsyncStorage, blockerId).then(imported => {
            if (imported) queryClient.invalidateQueries({ queryKey: blockKeys.all });
        });
    }, [state.userProfile.id, queryClient]);

    // Fetches notifications and messages, and subscribes to real-time updates.
    useEffect(() => {
        const userId = state.userProfile.id;
        if (!userId) return;

        let notificationsChannel: any;
        let messagesChannel: any;

        const setupSubscriptions = async () => {
            const { data, error } = await supabase
                .from("notifications")
                .select(`
                    id, type, is_read, created_at, content, comment_id,
                    sender:profiles!notifications_sender_id_fkey(id, username, avatar_url),
                    post:posts!notifications_post_id_fkey(id, content, media:image_url, media_type),
                    comment:comments!notifications_comment_id_fkey(id, text:content),
                    story:stories!notifications_story_id_fkey(id, media_url)
                `)
                .eq("receiver_id", userId)
                .order("created_at", { ascending: false });

            if (error) {
                console.error("Error fetching initial notifications:", error.message || error);
            } else {
                 setState(prev => ({
                    ...prev,
                    notifications: normalizeNotifications(data || [])
                }));
            }

            // Listen for new messages in real-time
            const fetchUnreadData = async () => {
                const { data, error } = await supabase
                    .from('messages')
                    .select('sender_id')
                    .eq('receiver_id', userId)
                    .eq('seen', false);
                if (!error && data) {
                    const senderIds = data.map(m => m.sender_id);
                    const unreadChatsSet = new Set(senderIds);
                    setState(prev => ({
                        ...prev,
                        unreadMessageCount: unreadChatsSet.size,
                        unreadChats: unreadChatsSet,
                    }));
                }
            };
            fetchUnreadData();

            messagesChannel = supabase
                .channel(`public:messages-realtime-${userId}-${Date.now()}`)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'messages' },
                    (payload) => {
                        const newMessage = payload.new as any;
                        const oldMessage = payload.old as any;

                        if (payload.eventType === 'INSERT') {
                            // Yeni mesaj geldi
                            if (newMessage.receiver_id === userId) {
                                setState(prev => {
                                    const updatedUnreadChats = new Set(prev.unreadChats);
                                    updatedUnreadChats.add(newMessage.sender_id);
                                    return {
                                        ...prev,
                                        unreadChats: updatedUnreadChats,
                                        unreadMessageCount: updatedUnreadChats.size,
                                    };
                                });
                            }
                        }

                        if (payload.eventType === 'UPDATE') {
                            // Mesaj 'seen' olduysa bildirimi kaldır
                            if (oldMessage?.seen === false && newMessage?.seen === true && newMessage.receiver_id === userId) {
                                setState(prev => {
                                    const updatedUnreadChats = new Set(prev.unreadChats);
                                    updatedUnreadChats.delete(newMessage.sender_id);
                                    return {
                                        ...prev,
                                        unreadChats: updatedUnreadChats,
                                        unreadMessageCount: updatedUnreadChats.size,
                                    };
                                });
                            }
                        }
                    }
                )
                .subscribe();
        };

        setupSubscriptions();

        return () => {
            if (notificationsChannel) supabase.removeChannel(notificationsChannel);
            if (messagesChannel) supabase.removeChannel(messagesChannel);
        };
    }, [state.userProfile.id]);

    const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
        const id = `toast-${Date.now()}`;
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => ({
            ...prevState,
            toasts: [...prevState.toasts, { id, message, type }],
        }));
    }, []);

    const showTopNotification = useCallback((title: string, message: string) => {
        setState(prevState => ({ ...prevState, topNotification: { title, message } }));
        setTimeout(() => {
            setState(prevState => ({ ...prevState, topNotification: null }));
        }, 3000);
    }, []);

    const syncUserData = useCallback(async (user: User) => {
        try {
            await ensureCurrentUserProfile();

            // Use Promise.all to fetch profile, likes, reposts, follows, and stories concurrently for better performance.
            const [profileResult, followingResult, myStoriesResult, storyLikesResult, unreadMessagesResult] = await Promise.all([
                supabase
                    .from('profiles')
                    .select('full_name, username, avatar_url, is_verified, is_admin, bio')
                    .eq('id', user.id)
                    .maybeSingle(),
                getFollowingList(user.id),
                getMyStories(user.id),
                supabase.from('story_likes').select('story_id').eq('user_id', user.id),
                supabase.from('messages').select('sender_id').eq('receiver_id', user.id).eq('seen', false)
            ]);

            // Destructure results
            const { data: profileData } = profileResult as any;
            const followingUsernames = followingResult as string[];
            const myStories = myStoriesResult as Story[];
            const { data: storyLikesData } = storyLikesResult as any;
            const { data: unreadMessagesData } = unreadMessagesResult;

            const unreadChats = new Set(unreadMessagesData?.map(m => m.sender_id) || []);
            const unreadMessageCount = unreadChats.size;

            // Update state in a single, batched call to avoid multiple re-renders.
            setState(prevState => {
                const newUserProfile = {
                    ...prevState.userProfile,
                    id: user.id,
                    name: user.user_metadata.full_name || profileData?.full_name || prevState.userProfile.name,
                    username: user.user_metadata.username || profileData?.username || prevState.userProfile.username,
                    profilePicture: user.user_metadata.avatar_url || profileData?.avatar_url || prevState.userProfile.profilePicture,
                    isVerified: profileData?.is_verified ?? prevState.userProfile.isVerified,
                    bio: profileData?.bio || prevState.userProfile.bio,
                };

                const isAdmin = profileData?.is_admin === true;


                const newFollowedUsernames = new Set(
                    (followingUsernames || []).map((username) => username.toLowerCase())
                );

                const newLikedStoryIds = (storyLikesData && Array.isArray(storyLikesData))
                    ? new Set(storyLikesData.map(l => l.story_id))
                    : prevState.likedStoryIds;

                return {
                    ...prevState,
                    userProfile: newUserProfile,
                    followedUsernames: newFollowedUsernames,
                    userStories: myStories,
                    likedStoryIds: newLikedStoryIds,
                    unreadMessageCount: unreadMessageCount,
                    unreadChats: unreadChats,
                    isAdmin: isAdmin,
                };
            });
        } catch (error) {
            console.error("Error syncing user data:", error);
            addToast("Could not sync your account data. Please try again later.", "error");
        }
    }, [addToast]);

    const refreshAllData = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            await Promise.all([
                syncUserData(user)
            ]);
        }
    }, [syncUserData]);

    useEffect(() => {
        const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED')) {
                await syncUserData(session.user);
            } else if (event === 'SIGNED_OUT') {
                setState(prevState => ({
                    ...prevState,
                    postComments: new Map(),
                    profilePosts: [],
                    userProfile: {
                        id: '',
                        name: 'OneTag User',
                        username: 'onetag_user',
                        bio: 'Hello, I am using OneTag',
                        profilePicture: null,
                    },
                    userStories: [],
                    storyComments: new Map(),
                    likedStoryIds: new Set(),
                    hasNewStory: false,
                    viewedStoryTimestamps: new Set(),
                    isViewingStory: false,
                    likedVideoIds: new Set(),
                    followedUsernames: new Set(),
                    votedPolls: new Map(),
                    notifications: null,
                    unreadMessageCount: 0,
                    unreadChats: new Set(),
                    topNotification: null,
                    isAdmin: false,
                }));
            }
        });

        return () => {
            authListener.subscription.unsubscribe();
        };
    }, [syncUserData]);

    const triggerHapticFeedback = useCallback(async (style: 'light' | 'medium' | 'heavy' = 'light') => {
        try {
            if (style === 'heavy') {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            } else if (style === 'medium') {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            } else {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
        } catch (error) {
            console.error("Haptics not available:", error);
        }
    }, []);

    // Like, Repost and Save moved to features/posts/mutations.ts in ONE-13.
    // They are cache operations now, not context state: the boolean lives on
    // the cached post and the rollback lives in lib/optimisticToggle.ts, so
    // there is nothing left for AppContext to hold. Screens call
    // useLikePost / useRepostPost / useSavePost.


    const postComment = useCallback(async (postId: string, content: string) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            addToast('You must be logged in to comment.', 'error');
            return;
        }

        const tempId = `temp-comment-${Date.now()}`;
        const optimisticComment: Comment = {
            id: tempId,
            userId: user.id,
            username: state.userProfile.username,
            avatar: state.userProfile.profilePicture,
            text: content,
            timestamp: new Date(),
            likes: 0,
            isLiked: false,
            replies: [],
        };

        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => {
            const newPostComments = new Map(prevState.postComments);
            const existingComments = newPostComments.get(postId);
            const allComments = Array.isArray(existingComments) ? existingComments : [];
            newPostComments.set(postId, [optimisticComment, ...allComments]);
            return { ...prevState, postComments: newPostComments };
        });

        try {
            const newCommentData = await apiAddComment(postId, user.id, content);

            const realComment: Comment = {
                id: newCommentData.id,
                userId: newCommentData.user_id,
                username: newCommentData.profiles.username,
                avatar: newCommentData.profiles.avatar_url,
                text: newCommentData.content,
                timestamp: new Date(newCommentData.created_at),
                likes: 0,
                isLiked: false,
                replies: [],
            };

            // FIX: Explicitly typed `prevState` as AppState.
            setState((prevState: AppState) => {
                const newPostComments = new Map(prevState.postComments);
                const postComments = newPostComments.get(postId) || [];
                const updatedComments = postComments.map(c => c.id === tempId ? realComment : c);
                newPostComments.set(postId, updatedComments);
                return { ...prevState, postComments: newPostComments };
            });

        } catch (error) {
            addToast('Failed to post comment.', 'error');
            console.error(error);
            // FIX: Explicitly typed `prevState` as AppState.
            setState((prevState: AppState) => {
                const newPostComments = new Map(prevState.postComments);
                const postComments = newPostComments.get(postId) || [];
                newPostComments.set(postId, postComments.filter(c => c.id !== tempId));
                return { ...prevState, postComments: newPostComments };
            });
        }
    }, [addToast, state.userProfile.username, state.userProfile.profilePicture]);

    const getComments = useCallback((postId: string) => state.postComments.get(postId) || [], [state.postComments]);

    const setComments = useCallback((postId: string, comments: Comment[]) => {
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => {
            const newPostComments = new Map(prevState.postComments);
            newPostComments.set(postId, comments);
            return { ...prevState, postComments: newPostComments };
        });
    }, []);

    const areCommentsLoaded = useCallback((postId: string) => state.postComments.has(postId), [state.postComments]);

    const addProfilePost = useCallback(async (post: Post) => {
        // Local media is uploaded by publishPost, which is the function that
        // knows what it is inserting. Uploading here as well meant every image
        // went up twice and a failure was swallowed into a broken post.
        try {
            const realPost = await publishPost(post);
            if (!realPost) {
                throw new Error("API returned null post.");
            }
        } catch (error) {
            console.error("Failed to publish post.", error);
            addToast(
                error instanceof MediaUploadError
                    ? 'Your photo could not be uploaded. Nothing was posted.'
                    : 'Failed to create post.',
                'error',
            );
            throw error;
        }
    }, [addToast]);

    const deleteProfilePost = useCallback((postId: string) => {
        // Optimistic update
        // FIX: Explicitly type prevState as AppState.
        setState((prevState: AppState) => ({
            ...prevState,
            profilePosts: prevState.profilePosts.filter(p => p.id !== postId),
        }));

        // If admin is deleting, call admin delete function
        if (state.isAdmin) {
            adminDeletePost(postId).catch(err => {
                 console.error("Failed to delete post as admin", err);
                 addToast("Could not delete post.", "error");
            });
        } else {
            deletePost(postId);
        }
    }, [state.isAdmin, addToast]);

     const updateProfilePost = useCallback((updatedPost: Post) => {
        // Optimistic update
        // FIX: Explicitly type prevState as AppState.
        setState((prevState: AppState) => ({
            ...prevState,
            profilePosts: prevState.profilePosts.map(p => p.id === updatedPost.id ? updatedPost : p),
        }));
        updatePost(updatedPost);
    }, []);

    const setProfilePosts = useCallback((posts: Post[]) => {
        // FIX: Explicitly type prevState as AppState.
        setState((prevState: AppState) => ({ ...prevState, profilePosts: posts }));
    }, []);

    const updateProfile = useCallback((newProfile: Partial<UserProfile>) => {
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => ({
            ...prevState,
            userProfile: {
                ...prevState.userProfile,
                ...newProfile,
            }
        }));
    }, []);

    const setTheme = useCallback((theme: 'light' | 'dark') => {
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => ({ ...prevState, theme }));
    }, []);

    const addUserStory = useCallback((story: Story) => {
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => ({
            ...prevState,
            userStories: [story, ...prevState.userStories],
            hasNewStory: true,
        }));
    }, []);

    const deleteStory = useCallback(async (storyId: string) => {
        const { id: userId } = state.userProfile;
        if (!userId) {
            addToast('You must be logged in to delete a story.', 'error');
            return;
        }

        const originalStories = [...state.userStories];

        // Optimistic update
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => ({
            ...prevState,
            userStories: prevState.userStories.filter(s => s.id !== storyId),
        }));

        if (storyId.startsWith('local-')) {
            addToast('Story upload failed.', 'error');
            return;
        }

        try {
            const success = await deleteStoryFromDatabase(storyId);
            if (!success) {
                throw new Error("Failed to delete story from server.");
            }
            addToast('Story deleted.', 'info');
        } catch (error) {
            console.error("Failed to delete story:", error);
            addToast('Could not delete story.', 'error');
            // Revert on failure
            // FIX: Explicitly typed `prevState` as AppState.
            setState((prevState: AppState) => ({ ...prevState, userStories: originalStories }));
        }
    }, [state.userStories, state.userProfile.id, addToast]);

    const replaceStory = useCallback((localId: string, realStory: Story) => {
        // FIX: Explicitly type prevState as AppState.
        setState((prevState: AppState) => ({
            ...prevState,
            userStories: prevState.userStories.map(story => story.id === localId ? realStory : story),
        }));
    }, []);

    const markStoriesViewed = useCallback(() => {
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => ({
            ...prevState,
            hasNewStory: false,
        }));
    }, []);

    const isStoryLiked = useCallback((storyId: string) => state.likedStoryIds.has(storyId), [state.likedStoryIds]);

    const toggleStoryLike = useCallback(async (story: Story) => {
        triggerHapticFeedback();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            addToast('You must be logged in to like stories.', 'error');
            return;
        }

        const storyId = story.id;
        if (storyId.startsWith('local-')) {
            addToast('Please wait for the story to finish uploading.', 'error');
            return;
        }

        const alreadyLiked = state.likedStoryIds.has(storyId);

        // Optimistic update
        // FIX: Explicitly type prevState as AppState.
        setState((prevState: AppState) => {
            const newLikedStoryIds = new Set(prevState.likedStoryIds);
            if (alreadyLiked) {
                newLikedStoryIds.delete(storyId);
            } else {
                newLikedStoryIds.add(storyId);
            }
            return { ...prevState, likedStoryIds: newLikedStoryIds };
        });

        try {
            await toggleStoryLikeInDatabase(storyId, user.id);
        } catch (error) {
            console.error("Failed to toggle story like:", error);
            addToast('Failed to update story like status.', 'error');
            // Revert on failure
            // FIX: Explicitly type prevState as AppState.
            setState((prevState: AppState) => {
                const newLikedStoryIds = new Set(prevState.likedStoryIds);
                if (alreadyLiked) {
                    newLikedStoryIds.add(storyId);
                } else {
                    newLikedStoryIds.delete(storyId);
                }
                return { ...prevState, likedStoryIds: newLikedStoryIds };
            });
        }
    }, [state.likedStoryIds, addToast, triggerHapticFeedback]);

    const getStoryComments = useCallback((storyId: string) => state.storyComments.get(storyId) || [], [state.storyComments]);

    const addStoryComment = useCallback((storyId: string, comment: Comment) => {
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => {
            const newStoryComments = new Map(prevState.storyComments);
            const comments = newStoryComments.get(storyId) || [];
            newStoryComments.set(storyId, [comment, ...comments]);
            return { ...prevState, storyComments: newStoryComments };
        });
    }, []);

    const setStoryComments = useCallback((storyId: string, comments: Comment[]) => {
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => {
            const newStoryComments = new Map(prevState.storyComments);
            newStoryComments.set(storyId, comments);
            return { ...prevState, storyComments: newStoryComments };
        });
    }, []);

    const isStoryViewed = useCallback((timestamp: string) => state.viewedStoryTimestamps.has(timestamp), [state.viewedStoryTimestamps]);

    const markStoryAsViewed = useCallback((timestamp: string) => {
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => {
            if (prevState.viewedStoryTimestamps.has(timestamp)) {
                return prevState;
            }
            const newViewed = new Set(prevState.viewedStoryTimestamps);
            newViewed.add(timestamp);
            return { ...prevState, viewedStoryTimestamps: newViewed };
        });
    }, []);

    const setIsViewingStory = useCallback((isViewing: boolean) => {
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => ({ ...prevState, isViewingStory: isViewing }));
    }, []);

    const isUserBlocked = blocks.isUserBlocked;

    /**
     * Kept on the context because a dozen screens call it, but it is a thin
     * pass-through to features/blocks now. It takes a username for the same
     * reason: that is what a post, a story or a search result carries.
     */
    const toggleBlockUser = useCallback((username: string) => {
        const alreadyBlocked = blocks.blockedUsers.find(user => user.username === username);

        if (alreadyBlocked) {
            blockToggle.toggle(alreadyBlocked);
            return;
        }

        // Blocking by username needs the id the row is keyed on, which the
        // caller does not have.
        supabase
            .from('profiles')
            .select('id, username, full_name, avatar_url')
            .eq('username', username)
            .maybeSingle()
            .then(({ data, error }) => {
                if (error || !data) {
                    console.error('Could not resolve user to block', error);
                    addToast('Could not block that account.', 'error');
                    return;
                }

                blockToggle.toggle({
                    userId: data.id,
                    username: data.username,
                    name: data.full_name,
                    avatarUrl: data.avatar_url,
                });
            });
    }, [blocks.blockedUsers, blockToggle, addToast]);

    const toggleVideoLike = useCallback((videoId: string) => {
        triggerHapticFeedback();
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => {
            const newLikedVideos = new Set(prevState.likedVideoIds);
            if (newLikedVideos.has(videoId)) {
                newLikedVideos.delete(videoId);
            } else {
                newLikedVideos.add(videoId);
            }
            return { ...prevState, likedVideoIds: newLikedVideos };
        });
    }, [triggerHapticFeedback]);

    const isVideoLiked = useCallback((videoId: string) => state.likedVideoIds.has(videoId), [state.likedVideoIds]);

    const toggleFollowUser = useCallback(async (username: string) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            addToast('You must be logged in to follow users.', 'error');
            return;
        }

        const normalizedUsername = username.trim().toLowerCase();
        if (!normalizedUsername) return;

        const { data: targetUserData, error: targetUserError } = await supabase
            .from('profiles')
            .select('id')
            .ilike('username', normalizedUsername)
            .single();

        if (targetUserError || !targetUserData) {
            addToast(`Could not find user @${username}.`, 'error');
            return;
        }
        const targetUserId = targetUserData.id;
        if (targetUserId === user.id) return;

        const alreadyFollowing = state.followedUsernames.has(normalizedUsername);

        // Optimistic update
        setState((prevState: AppState) => {
            const newFollowed = new Set(prevState.followedUsernames);
            if (alreadyFollowing) {
                newFollowed.delete(normalizedUsername);
            } else {
                newFollowed.add(normalizedUsername);
            }
            return { ...prevState, followedUsernames: newFollowed };
        });

        try {
            if (alreadyFollowing) {
                await unfollowUser(user.id, targetUserId);
            } else {
                await followUser(user.id, targetUserId);
            }
            // Re-sync with database after action to ensure consistency.
            const usernames = await getFollowingList(user.id);
            setState(prev => ({
                ...prev,
                followedUsernames: new Set(usernames.map((item) => item.toLowerCase())),
            }));
        } catch (error) {
            console.error("Failed to toggle follow:", error);
            addToast('Failed to update follow status.', 'error');
            // Revert on failure
            setState((prevState: AppState) => {
                const newFollowed = new Set(prevState.followedUsernames);
                if (alreadyFollowing) {
                    newFollowed.add(normalizedUsername);
                } else {
                    newFollowed.delete(normalizedUsername);
                }
                return { ...prevState, followedUsernames: newFollowed };
            });
        }
    }, [state.followedUsernames, addToast]);

    const isUserFollowed = useCallback(
        (username: string) => state.followedUsernames.has(username.trim().toLowerCase()),
        [state.followedUsernames]
    );

    const voteInPoll = useCallback((postId: string, optionIndex: number) => {
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => {
            const newVotedPolls = new Map(prevState.votedPolls);
            newVotedPolls.set(postId, optionIndex);
            return { ...prevState, votedPolls: newVotedPolls };
        });
    }, []);

    const getPollVote = useCallback((postId: string) => state.votedPolls.get(postId), [state.votedPolls]);

    const markAllNotificationsAsRead = useCallback(async (userId?: string) => {
      if (!userId) return;
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("receiver_id", userId)
        .eq("is_read", false);

      if (error) {
        console.error("Error marking notifications as read:", error.message || error);
      } else {
        const { data, error: fetchError } = await supabase
          .from("notifications")
          .select(`
              id, type, is_read, created_at, content, comment_id,
              sender:profiles!notifications_sender_id_fkey(id, username, avatar_url),
              post:posts!notifications_post_id_fkey(id, content, media:image_url, media_type),
              comment:comments!notifications_comment_id_fkey(id, text:content),
              story:stories!notifications_story_id_fkey(id, media_url)
          `)
          .eq("receiver_id", userId)
          .order("created_at", { ascending: false });

        if (fetchError) {
            console.error("Error refetching notifications after marking as read:", fetchError.message || fetchError);
        } else {
            setState((prev: AppState) => ({
                ...prev,
                notifications: normalizeNotifications(data || []),
            }));
        }
      }
    }, []);

    const markAllMessagesAsRead = useCallback(async () => {
        const userId = state.userProfile.id;
        if (!userId || state.unreadMessageCount === 0) return;

        // Optimistic update
        // FIX: Explicitly type prev as AppState.
        setState((prev: AppState) => ({ ...prev, unreadMessageCount: 0, unreadChats: new Set() }));

        const { error } = await supabase
            .from("messages")
            .update({ seen: true })
            .eq("receiver_id", userId)
            .eq("seen", false);

        if (error) {
            console.error("Error marking all messages as read:", error.message || error);
        } else {
        }
    }, [state.userProfile.id, state.unreadMessageCount]);

    const markChatAsRead = useCallback(async (senderId: string) => {
        const userId = state.userProfile.id;
        if (!userId) return;

        // 1️⃣ Veritabanını güncelle
        const success = await apiMarkMessagesAsRead(userId, senderId);

        if (success) {
            // 2️⃣ UI'daki unread state'ini güncelle
            // FIX: Explicitly type prev as AppState.
            setState((prev: AppState) => {
                const updatedUnreadChats = new Set(prev.unreadChats);
                updatedUnreadChats.delete(senderId); // mavi/kırmızı noktayı kaldır

                return {
                    ...prev,
                    unreadChats: updatedUnreadChats,
                    unreadMessageCount: updatedUnreadChats.size,
                };
            });
        } else {
            console.error("Failed to mark chat as read");
            addToast("Couldn't mark messages as read.", 'error');
        }
    }, [state.userProfile.id, addToast]);

    const removeToast = useCallback((id: string) => {
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => ({
            ...prevState,
            toasts: prevState.toasts.filter(toast => toast.id !== id),
        }));
    }, []);

    const setTooltip = useCallback((tooltip: { text: string } | null) => {
        // FIX: Explicitly type prevState as AppState.
        setState((prevState: AppState) => ({ ...prevState, tooltip }));
    }, []);

    const contextValue = useMemo(() => ({
        ...state,
        postComment,
        getComments,
        setComments,
        areCommentsLoaded,
        addProfilePost,
        deleteProfilePost,
        updateProfilePost,
        setProfilePosts,
        updateProfile,
        setTheme,
        addUserStory,
        deleteStory,
        markStoriesViewed,
        isStoryLiked,
        toggleStoryLike,
        getStoryComments,
        addStoryComment,
        setStoryComments,
        isStoryViewed,
        markStoryAsViewed,
        setIsViewingStory,
        toggleBlockUser,
        isUserBlocked,
        toggleVideoLike,
        isVideoLiked,
        toggleFollowUser,
        isUserFollowed,
        voteInPoll,
        getPollVote,
        addToast,
        removeToast,
        showTopNotification,
        triggerHapticFeedback,
        setTooltip,
        refreshAllData,
        markAllNotificationsAsRead,
        markAllMessagesAsRead,
        markChatAsRead,
        replaceStory,
    }), [
        state,
        postComment,
        getComments,
        setComments,
        areCommentsLoaded,
        addProfilePost,
        deleteProfilePost,
        updateProfilePost,
        setProfilePosts,
        updateProfile,
        setTheme,
        addUserStory,
        deleteStory,
        markStoriesViewed,
        isStoryLiked,
        toggleStoryLike,
        getStoryComments,
        addStoryComment,
        setStoryComments,
        isStoryViewed,
        markStoryAsViewed,
        setIsViewingStory,
        toggleBlockUser,
        isUserBlocked,
        toggleVideoLike,
        isVideoLiked,
        toggleFollowUser,
        isUserFollowed,
        voteInPoll,
        getPollVote,
        addToast,
        removeToast,
        showTopNotification,
        triggerHapticFeedback,
        setTooltip,
        refreshAllData,
        markAllNotificationsAsRead,
        markAllMessagesAsRead,
        markChatAsRead,
        replaceStory,
    ]);

    return (
        <AppContext.Provider value={contextValue}>
            {children}
        </AppContext.Provider>
    );
};

export const useApp = (): AppContextType => {
    const context = useContext(AppContext);
    if (context === undefined) {
        throw new Error('useApp must be used within an AppProvider');
    }
    return context;
};
