//
// target: __tests__/components/HomeScreen.test.ts
//
// HomeScreen pure-logic snapshot tests. The component delegates the
// screen-shell decisions — header brand, the header's two actions, and
// which empty or error state the feed shows — to a sidecar module
// (`lib/screens/home.ts`) so those rules can be exercised without spinning
// up React Native, expo-router, or the AppContext provider. These tests pin
// every value the user actually sees on the Home tab so a refactor cannot
// silently change the screen shell.
//
// Coverage:
//   1. Header brand (the literal "OneTag" string)
//   2. Empty and error states (loading / error + Retry / "Nothing new yet" +
//      Explore / the new-user welcome)
//   3. Unread badges (drawn by IconButton: hidden at zero, "99+" past 99)
//   4. Header action targets (/notifications and /messages) and labels

import {
    HOME_EMPTY_FOLLOWING_ACTION,
    HOME_EMPTY_FOLLOWING_BODY,
    HOME_EMPTY_FOLLOWING_TITLE,
    HOME_EMPTY_NEW_USER_BODY,
    HOME_EMPTY_NEW_USER_TITLE,
    HOME_EXPLORE_TARGET,
    HOME_FEED_ERROR_ACTION,
    HOME_FEED_ERROR_BODY,
    HOME_FEED_ERROR_TITLE,
    HOME_HEADER_ACTIONS,
    HOME_HEADER_BRAND,
    HOME_SUGGESTIONS_HEADING,
    getHomeEmptyState,
    getHomeHeaderLabel,
    getHomeHeaderTarget,
} from '../../lib/screens/home';
import { badgeLabel } from '../../components/native/ui/IconButton';

jest.mock('react-native', () => ({
    Pressable: () => null,
    View: () => null,
    Text: () => null,
    StyleSheet: { create: (sheet: unknown) => sheet },
}), { virtual: true });

// ---------------------------------------------------------------------------
// 1. Header brand
// ---------------------------------------------------------------------------

describe('HomeScreen – header brand', () => {
    it('renders the literal brand word "OneTag" in the header', () => {
        // The component sets its own font from the type tokens but the
        // displayed string is the same canonical brand word the rest
        // of the app uses.
        expect(HOME_HEADER_BRAND).toBe('OneTag');
    });

    it('the brand is a non-empty string with no surrounding whitespace', () => {
        // A regression guard against accidental " OneTag" / "OneTag\n"
        // typos in the constant that would push whitespace into the
        // header.
        expect(typeof HOME_HEADER_BRAND).toBe('string');
        expect(HOME_HEADER_BRAND).toBe(HOME_HEADER_BRAND.trim());
        expect(HOME_HEADER_BRAND.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 2. Empty and error states
// ---------------------------------------------------------------------------

describe('HomeScreen – empty and error states', () => {
    it('returns the loading sentinel while the initial feed fetch is in flight', () => {
        // The component renders the skeletons during the first load and
        // skips every empty-state branch entirely.
        expect(getHomeEmptyState(true, false).kind).toBe('loading');
        expect(getHomeEmptyState(true, true).kind).toBe('loading');
        expect(getHomeEmptyState(true, false, true).kind).toBe('loading');
    });

    it('shows "Couldn\'t load your feed" with Retry once the feed query has failed', () => {
        expect(getHomeEmptyState(false, true, true)).toEqual({
            kind: 'error',
            title: HOME_FEED_ERROR_TITLE,
            body: HOME_FEED_ERROR_BODY,
            action: HOME_FEED_ERROR_ACTION,
        });
        expect(HOME_FEED_ERROR_TITLE).toBe("Couldn't load your feed");
        expect(HOME_FEED_ERROR_ACTION).toBe('Retry');
    });

    it('the error state wins over both empty states', () => {
        expect(getHomeEmptyState(false, false, true).kind).toBe('error');
    });

    it('shows "Nothing new yet" with an Explore action when the user follows people', () => {
        expect(getHomeEmptyState(false, true)).toEqual({
            kind: 'following-no-posts',
            title: HOME_EMPTY_FOLLOWING_TITLE,
            body: HOME_EMPTY_FOLLOWING_BODY,
            action: HOME_EMPTY_FOLLOWING_ACTION,
        });
        expect(HOME_EMPTY_FOLLOWING_TITLE).toBe('Nothing new yet');
        expect(HOME_EMPTY_FOLLOWING_ACTION).toBe('Explore');
    });

    it('Explore goes to the Explore tab', () => {
        expect(HOME_EXPLORE_TARGET).toBe('/(tabs)/search');
    });

    it('welcomes someone who follows nobody, ahead of the suggestions', () => {
        expect(getHomeEmptyState(false, false)).toEqual({
            kind: 'new-user',
            title: HOME_EMPTY_NEW_USER_TITLE,
            body: HOME_EMPTY_NEW_USER_BODY,
        });
        expect(HOME_EMPTY_NEW_USER_TITLE).toBe('Your feed starts with who you follow');
        expect(HOME_SUGGESTIONS_HEADING).toBe('Suggested for you');
    });

    it('keeps each body to one line of copy', () => {
        for (const body of [HOME_EMPTY_FOLLOWING_BODY, HOME_EMPTY_NEW_USER_BODY, HOME_FEED_ERROR_BODY]) {
            expect(body.length).toBeGreaterThan(0);
            expect(body).not.toContain('\n');
        }
    });

    it('the empty states are mutually exclusive in copy', () => {
        const titles = [HOME_EMPTY_FOLLOWING_TITLE, HOME_EMPTY_NEW_USER_TITLE, HOME_FEED_ERROR_TITLE];
        expect(new Set(titles).size).toBe(titles.length);
    });
});

// ---------------------------------------------------------------------------
// 3. Unread badges
// ---------------------------------------------------------------------------

describe('HomeScreen – unread badges', () => {
    // Each header action is an IconButton carrying its own count; the badge
    // text is IconButton's badgeLabel, the same rule as the tab bar.
    it('hides the badge at zero', () => {
        expect(badgeLabel(0)).toBeNull();
    });

    it('shows counts up to 99 verbatim', () => {
        expect(badgeLabel(1)).toBe('1');
        expect(badgeLabel(42)).toBe('42');
        expect(badgeLabel(99)).toBe('99');
    });

    it('overflows to "99+"', () => {
        expect(badgeLabel(100)).toBe('99+');
        expect(badgeLabel(9_999)).toBe('99+');
    });
});

// ---------------------------------------------------------------------------
// 4. Header action targets
// ---------------------------------------------------------------------------

describe('HomeScreen – header action navigation targets', () => {
    it('exposes exactly two header actions: notifications and messages', () => {
        // The screen renders a bell icon and a send icon in the top
        // right; there are no other action slots. Lock the count and
        // the keys so a refactor cannot accidentally drop or rename
        // one.
        expect(HOME_HEADER_ACTIONS).toHaveLength(2);
        const keys = HOME_HEADER_ACTIONS.map(a => a.key);
        expect(keys).toEqual(['notifications', 'messages']);
    });

    it('routes the bell icon to /notifications', () => {
        expect(getHomeHeaderTarget('notifications')).toBe('/notifications');
    });

    it('routes the send icon to /messages', () => {
        expect(getHomeHeaderTarget('messages')).toBe('/messages');
    });

    it('the two target routes are distinct', () => {
        const targets = HOME_HEADER_ACTIONS.map(a => a.target);
        expect(new Set(targets).size).toBe(targets.length);
    });

    it('every action declares its target as a non-empty string starting with /', () => {
        // expo-router uses leading-slash paths; this guards against
        // someone rewriting one of the constants to a bare "messages"
        // or "https://..." URL.
        for (const action of HOME_HEADER_ACTIONS) {
            expect(typeof action.target).toBe('string');
            expect(action.target.startsWith('/')).toBe(true);
            expect(action.target.length).toBeGreaterThan(1);
        }
    });
});

describe('HomeScreen – header action labels', () => {
    it('names each action, and says how many are unread', () => {
        expect(getHomeHeaderLabel('notifications', 0)).toBe('Notifications');
        expect(getHomeHeaderLabel('notifications', 3)).toBe('Notifications, 3 unread');
        expect(getHomeHeaderLabel('messages', 0)).toBe('Messages');
        expect(getHomeHeaderLabel('messages', 120)).toBe('Messages, 120 unread');
    });
});
