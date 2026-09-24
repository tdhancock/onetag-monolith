// Global UI state — and only UI state.
//
// Everything a server owns lives in TanStack Query, in `features/`. What is
// left here has no server behind it: the theme, toasts, the tooltip, the
// top-of-screen banner, the flag that hides chrome while a OneSnap plays, and
// which stories this device has already seen (AsyncStorage-backed, because it
// is per device, not per account).
//
// ONE-20 finished the move: the auth session went to `features/auth`, the
// admin flag to `features/admin`, and the refresh-everything call — a hand-rolled
// refetch — to query invalidation at its one call site.
//
// Two pass-throughs remain on the context value, deliberately:
//   * `userProfile` — the signed-in profile, derived from `features/profiles`.
//     Held in no state; ONE-22 moves its readers onto `useCurrentProfile()`.
//   * `isUserBlocked` / `toggleBlockUser` — thin calls into `features/blocks`,
//     kept because a dozen screens call them by username. They hold no data.

import React, { createContext, useContext, useState, ReactNode, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useAuthSessionSync, useAuthUserId } from '../features/auth';
import { useBlockedUsers, useBlockToggle, migrateLocalBlocks, blockKeys } from '../features/blocks';
import { useCurrentUserQuery } from '../features/profiles';
import { useNotificationsRealtime } from '../features/notifications';
import { useMessagesRealtime } from '../features/messages';
import { getJSON, setJSON } from '../services/storage';
import { supabase } from '../services/supabase.native';
import {
    VIEWED_STORIES_KEY,
    parseViewedStoryTimestamps,
    serializeViewedStoryTimestamps,
} from '../lib/viewedStories';
import type { UserProfile, Toast } from '../types';

interface AppState {
    theme: 'light' | 'dark';
    toasts: Toast[];
    tooltip: { text: string } | null;
    topNotification: { title: string; message: string } | null;
    /** A OneSnap is playing; other chrome stays out of the way. */
    isViewingStory: boolean;
    /**
     * Which stories this device has seen, by timestamp. Per device, not per
     * account — AsyncStorage-backed, and kept across sign-out (ONE-19).
     */
    viewedStoryTimestamps: Set<string>;
}

interface AppContextType extends AppState {
    /**
     * The signed-in profile, derived from `features/profiles` — a pass-through,
     * not state. While loading or signed out it is the placeholder with
     * `id: ''`, so `userProfile?.id` guards read as "not ready".
     */
    userProfile: UserProfile;
    setTheme: (theme: 'light' | 'dark') => void;
    addToast: (message: string, type?: Toast['type']) => void;
    removeToast: (id: string) => void;
    setTooltip: (tooltip: { text: string } | null) => void;
    showTopNotification: (title: string, message: string) => void;
    triggerHapticFeedback: (style?: 'light' | 'medium' | 'heavy') => void;
    setIsViewingStory: (isViewing: boolean) => void;
    markStoryAsViewed: (timestamp: string) => void;
    isStoryViewed: (timestamp: string) => boolean;
    /** Pass-through to features/blocks, by username. */
    isUserBlocked: (username: string) => boolean;
    /** Pass-through to features/blocks, by username. */
    toggleBlockUser: (username: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [state, setState] = useState<AppState>(() => ({
        theme: 'dark',
        toasts: [],
        tooltip: null,
        topNotification: null,
        isViewingStory: false,
        viewedStoryTimestamps: new Set(),
    }));

    const queryClient = useQueryClient();

    // ─── Toasts, tooltip, banner, haptics ─────────────────────────────────

    const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
        const id = `toast-${Date.now()}`;
        setState(prev => ({ ...prev, toasts: [...prev.toasts, { id, message, type }] }));
    }, []);

    const removeToast = useCallback((id: string) => {
        setState(prev => ({ ...prev, toasts: prev.toasts.filter(toast => toast.id !== id) }));
    }, []);

    const setTooltip = useCallback((tooltip: { text: string } | null) => {
        setState(prev => ({ ...prev, tooltip }));
    }, []);

    const showTopNotification = useCallback((title: string, message: string) => {
        setState(prev => ({ ...prev, topNotification: { title, message } }));
        setTimeout(() => {
            setState(prev => ({ ...prev, topNotification: null }));
        }, 3000);
    }, []);

    const triggerHapticFeedback = useCallback(async (style: 'light' | 'medium' | 'heavy' = 'light') => {
        try {
            const impact = style === 'heavy'
                ? Haptics.ImpactFeedbackStyle.Heavy
                : style === 'medium'
                    ? Haptics.ImpactFeedbackStyle.Medium
                    : Haptics.ImpactFeedbackStyle.Light;
            await Haptics.impactAsync(impact);
        } catch (error) {
            console.error('Haptics not available:', error);
        }
    }, []);

    const setTheme = useCallback((theme: 'light' | 'dark') => {
        setState(prev => ({ ...prev, theme }));
    }, []);

    // ─── Session wiring ────────────────────────────────────────────────────
    //
    // Mounted here because this provider lives exactly as long as the app
    // does. The session, the profile and the admin flag are all queries; this
    // only wires them up.

    useAuthSessionSync({
        onSyncError: () => addToast('Could not sync your account data. Please try again later.', 'error'),
    });

    const authUserId = useAuthUserId();
    const { userProfile } = useCurrentUserQuery(authUserId);

    // Notifications (ONE-17) and direct messages (ONE-18) stay live for the
    // whole session, whichever screen is open.
    useNotificationsRealtime(userProfile.id || undefined);
    useMessagesRealtime(userProfile.id || undefined);

    // ─── Blocking (pass-through to features/blocks) ────────────────────────

    const blocks = useBlockedUsers(userProfile.id || undefined);
    const blockToggle = useBlockToggle(userProfile.id || undefined);

    // One-time import of the old device-local list (ONE-54).
    useEffect(() => {
        const blockerId = userProfile.id;
        if (!blockerId) return;

        migrateLocalBlocks(AsyncStorage, blockerId).then(imported => {
            if (imported) queryClient.invalidateQueries({ queryKey: blockKeys.all });
        });
    }, [userProfile.id, queryClient]);

    const isUserBlocked = blocks.isUserBlocked;

    /**
     * Block or unblock by username — what a post, a story or a search result
     * carries. Blocking needs the id the row is keyed on, so an account not
     * already in the list is resolved first.
     */
    const toggleBlockUser = useCallback((username: string) => {
        const alreadyBlocked = blocks.blockedUsers.find(user => user.username === username);

        if (alreadyBlocked) {
            blockToggle.toggle(alreadyBlocked);
            return;
        }

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

    // ─── Stories: the viewing flag and the per-device viewed set ───────────

    const setIsViewingStory = useCallback((isViewing: boolean) => {
        setState(prev => ({ ...prev, isViewingStory: isViewing }));
    }, []);

    const isStoryViewed = useCallback(
        (timestamp: string) => state.viewedStoryTimestamps.has(timestamp),
        [state.viewedStoryTimestamps],
    );

    const markStoryAsViewed = useCallback((timestamp: string) => {
        setState(prev => {
            if (prev.viewedStoryTimestamps.has(timestamp)) return prev;
            const viewed = new Set(prev.viewedStoryTimestamps);
            viewed.add(timestamp);
            return { ...prev, viewedStoryTimestamps: viewed };
        });
    }, []);

    // Rehydrate the viewed set once. A mark made before the read finishes is
    // kept — the stored set is merged in, not swapped for it — and nothing is
    // written back until the read has landed, so it cannot be overwritten.
    const viewedHydrated = useRef(false);

    useEffect(() => {
        let cancelled = false;

        getJSON<unknown>(VIEWED_STORIES_KEY)
            .catch(() => null)
            .then(payload => {
                if (cancelled) return;
                const stored = parseViewedStoryTimestamps(payload);
                viewedHydrated.current = true;
                setState(prev => {
                    if (stored.size === 0) return prev;
                    return { ...prev, viewedStoryTimestamps: new Set([...stored, ...prev.viewedStoryTimestamps]) };
                });
            });

        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!viewedHydrated.current) return;
        setJSON(VIEWED_STORIES_KEY, serializeViewedStoryTimestamps(state.viewedStoryTimestamps))
            .catch(error => console.warn('Could not persist viewed stories', error));
    }, [state.viewedStoryTimestamps]);

    // ─── Context value ─────────────────────────────────────────────────────

    const contextValue = useMemo<AppContextType>(() => ({
        ...state,
        userProfile,
        setTheme,
        addToast,
        removeToast,
        setTooltip,
        showTopNotification,
        triggerHapticFeedback,
        setIsViewingStory,
        markStoryAsViewed,
        isStoryViewed,
        isUserBlocked,
        toggleBlockUser,
    }), [
        state,
        userProfile,
        setTheme,
        addToast,
        removeToast,
        setTooltip,
        showTopNotification,
        triggerHapticFeedback,
        setIsViewingStory,
        markStoryAsViewed,
        isStoryViewed,
        isUserBlocked,
        toggleBlockUser,
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
