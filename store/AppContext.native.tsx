

import React, { createContext, useContext, useState, ReactNode, useCallback, useMemo, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useBlockedUsers, useBlockToggle, migrateLocalBlocks, blockKeys } from '../features/blocks';
import { useCurrentUserQuery } from '../features/profiles';
import { useNotificationsRealtime } from '../features/notifications';
import { useMessagesRealtime } from '../features/messages';
import { getMyStories, deleteStoryFromDatabase, toggleStoryLikeInDatabase, ensureCurrentUserProfile } from '../services/apiService';
import { supabase } from '../services/supabase.native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import type { Comment, Story, UserProfile, Toast } from '../types';

interface AppState {
    /**
     * The signed-in auth user's id — the session, not their profile row.
     *
     * The profile itself is a query (ONE-15); this is what keys it, and it is
     * the one piece of identity AppContext still owns because it comes from
     * the auth listener rather than from a table.
     */
    authUserId: string;
    theme: 'light' | 'dark';
    userStories: Story[];
    storyComments: Map<string, Comment[]>;
    likedStoryIds: Set<string>;
    hasNewStory: boolean;
    viewedStoryTimestamps: Set<string>;
    isViewingStory: boolean;
    votedPolls: Map<string, number>;
    toasts: Toast[];
    tooltip: { text: string } | null;
    topNotification: { title: string; message: string } | null;
    isAdmin: boolean;
}

interface AppContextType extends AppState {
    /**
     * The signed-in user. Sourced from `features/profiles` rather than from
     * AppState (ONE-15), but still handed out here because it is the app's
     * identity object. While loading it is the placeholder with `id: ''`, so
     * `userProfile?.id` guards read as "not ready" exactly as before.
     */
    userProfile: UserProfile;
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
    voteInPoll: (postId: string, optionIndex: number) => void;
    getPollVote: (postId: string) => number | undefined;
    addToast: (message: string, type?: Toast['type']) => void;
    removeToast: (id: string) => void;
    showTopNotification: (title: string, message: string) => void;
    triggerHapticFeedback: (style?: 'light' | 'medium' | 'heavy') => void;
    setTooltip: (tooltip: { text: string } | null) => void;
    refreshAllData: () => Promise<void>;
    replaceStory: (localId: string, realStory: Story) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [state, setState] = useState<AppState>(() => {
        return {
            authUserId: '',
            theme: 'dark',
            userStories: [],
            storyComments: new Map(),
            likedStoryIds: new Set(),
            hasNewStory: false,
            viewedStoryTimestamps: new Set(),
            isViewingStory: false,
            votedPolls: new Map(),
            toasts: [],
            tooltip: null,
            topNotification: null,
            isAdmin: false,
        };
    });

    const queryClient = useQueryClient();

    /**
     * The signed-in user's profile.
     *
     * Still on the context because it is the app's identity object and a
     * dozen screens read it, but it is a query now, not AppState (ONE-15).
     * The loading shape keeps `id: ''`, so every existing `userProfile?.id`
     * guard — push-notification registration in app/_layout.tsx above all —
     * behaves exactly as it did.
     */
    const { userProfile } = useCurrentUserQuery(state.authUserId || undefined);

    // Blocking lives on the server now (ONE-54). The list is a query, and
    // `isUserBlocked` reads from it rather than from AppState — a block that
    // only this device knows about is not a block.
    const blocks = useBlockedUsers(userProfile.id || undefined);
    const blockToggle = useBlockToggle(userProfile.id || undefined);

    // One-time migration of the device-local list (ONE-54). The logic lives
    // in features/blocks so the tests drive the same code this does.
    useEffect(() => {
        const blockerId = userProfile.id;
        if (!blockerId) return;

        migrateLocalBlocks(AsyncStorage, blockerId).then(imported => {
            if (imported) queryClient.invalidateQueries({ queryKey: blockKeys.all });
        });
    }, [userProfile.id, queryClient]);

    // Notifications (ONE-17) and direct messages (ONE-18) are queries, each
    // kept live by its own realtime hook. They are mounted here because this
    // provider lives exactly as long as a signed-in session does — the
    // unread badge has to move whichever screen is open.
    useNotificationsRealtime(userProfile.id || undefined);
    useMessagesRealtime(userProfile.id || undefined);

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

            // The profile itself is a query now (ONE-15) — this no longer
            // fetches it, it just records who is signed in and lets
            // useCurrentUserQuery do the rest. What stays here is the state
            // no server-side feature owns yet: stories and the admin flag.
            const [profileResult, myStoriesResult, storyLikesResult] = await Promise.all([
                supabase
                    .from('profiles')
                    .select('is_admin')
                    .eq('id', user.id)
                    .maybeSingle(),
                getMyStories(user.id),
                supabase.from('story_likes').select('story_id').eq('user_id', user.id),
            ]);

            const { data: profileData } = profileResult as any;
            const myStories = myStoriesResult as Story[];
            const { data: storyLikesData } = storyLikesResult as any;

            // Update state in a single, batched call to avoid multiple re-renders.
            setState(prevState => {
                const newLikedStoryIds = (storyLikesData && Array.isArray(storyLikesData))
                    ? new Set(storyLikesData.map(l => l.story_id))
                    : prevState.likedStoryIds;

                return {
                    ...prevState,
                    authUserId: user.id,
                    userStories: myStories,
                    likedStoryIds: newLikedStoryIds,
                    isAdmin: profileData?.is_admin === true,
                };
            });
        } catch (error) {
            console.error("Error syncing user data:", error);
            addToast("Could not sync your account data. Please try again later.", "error");
        }
    }, [addToast]);

    const refreshAllData = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Pull-to-refresh now means both halves: the state this provider still
        // owns, and every query — the profile, its posts, follows, blocks —
        // which used to be fetched here by hand (ONE-15).
        await Promise.all([
            syncUserData(user),
            queryClient.invalidateQueries(),
        ]);
    }, [syncUserData, queryClient]);

    useEffect(() => {
        const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED')) {
                await syncUserData(session.user);
            } else if (event === 'SIGNED_OUT') {
                setState(prevState => ({
                    ...prevState,
                    authUserId: '',
                    userStories: [],
                    storyComments: new Map(),
                    likedStoryIds: new Set(),
                    hasNewStory: false,
                    viewedStoryTimestamps: new Set(),
                    isViewingStory: false,
                    votedPolls: new Map(),
                    topNotification: null,
                    isAdmin: false,
                }));

                // Every query cached under the previous account is about
                // somebody who is no longer here — their profile, their
                // follows, their blocks. Clearing is the only honest move;
                // the keys are per-user but the cache outlives the session.
                queryClient.clear();
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


    // Comments moved to features/comments in ONE-14: the cache they were
    // kept in here was a query cache, hand-rolled, with a loaded flag and a
    // 209-line fetch guard in front of it. Screens use useCommentsQuery and
    // useAddComment / useDeleteComment.

    // Publishing, editing and deleting a post moved to
    // features/posts/mutations.ts in ONE-15: they existed here only to keep a
    // a local array of the user's own posts in step, and that array is a
    // query now. Screens
    // call useCreatePost / useUpdatePost / useDeletePost.

    // updateProfile moved to features/profiles/mutations.ts (useUpdateProfile).

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
        const { id: userId } = userProfile;
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
    }, [state.userStories, userProfile.id, addToast]);

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

    // Following moved to features/profiles/mutations.ts (useToggleFollow), on
    // the shared optimistic helper. Follow state is read from the query by
    // useFollowState.

    const voteInPoll = useCallback((postId: string, optionIndex: number) => {
        // FIX: Explicitly typed `prevState` as AppState.
        setState((prevState: AppState) => {
            const newVotedPolls = new Map(prevState.votedPolls);
            newVotedPolls.set(postId, optionIndex);
            return { ...prevState, votedPolls: newVotedPolls };
        });
    }, []);

    const getPollVote = useCallback((postId: string) => state.votedPolls.get(postId), [state.votedPolls]);

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
        voteInPoll,
        getPollVote,
        addToast,
        removeToast,
        showTopNotification,
        triggerHapticFeedback,
        setTooltip,
        refreshAllData,
        replaceStory,
        userProfile,
    }), [
        state,
        userProfile,
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
        voteInPoll,
        getPollVote,
        addToast,
        removeToast,
        showTopNotification,
        triggerHapticFeedback,
        setTooltip,
        refreshAllData,
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
