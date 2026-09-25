//
// Pure logic extracted from app/(tabs)/index.tsx (the HomeFeedScreen
// component) so the screen-shell decisions — header brand, the header's two
// actions, and which empty or error state the feed shows — can be exercised
// in tests without spinning up React Native, expo-router, or the AppContext
// provider.
//
// The unread badges on the header's two actions are drawn by IconButton,
// whose `badgeLabel` owns the count rule (hidden at zero, "99+" past 99), the
// same rule as the tab bar.

/**
 * Brand word rendered in the screen header. The header sets its own font
 * from the type tokens, but the literal string is just `"OneTag"`.
 * Centralising the constant lets the test pin the brand to one place.
 */
export const HOME_HEADER_BRAND = 'OneTag' as const;

/**
 * The feed's empty state for someone who follows people who have not posted:
 * a title, one line of body, and the Explore action (Waterfall Discovery —
 * the page always offers somewhere to go next).
 */
export const HOME_EMPTY_FOLLOWING_TITLE = 'Nothing new yet' as const;
export const HOME_EMPTY_FOLLOWING_BODY =
  "The people you follow haven't posted anything yet." as const;
export const HOME_EMPTY_FOLLOWING_ACTION = 'Explore' as const;

/**
 * The feed's empty state for someone who follows nobody yet. The screen
 * follows it with the "Suggested for you" row.
 */
export const HOME_EMPTY_NEW_USER_TITLE = 'Your feed starts with who you follow' as const;
export const HOME_EMPTY_NEW_USER_BODY = 'Follow a few people and their posts will show up here.' as const;
export const HOME_SUGGESTIONS_HEADING = 'Suggested for you' as const;

/** What the feed shows once its query has failed and it has nothing cached. */
export const HOME_FEED_ERROR_TITLE = "Couldn't load your feed" as const;
export const HOME_FEED_ERROR_BODY = 'Check your connection and try again.' as const;
export const HOME_FEED_ERROR_ACTION = 'Retry' as const;

/** Where the Explore action goes: the Explore tab. */
export const HOME_EXPLORE_TARGET = '/(tabs)/search' as const;

/**
 * Description of the state the feed's empty area renders. `kind`
 * discriminates the branches in the component; `title` and `body` are the
 * literal strings shown to the user, and `action` its single button.
 */
export type HomeEmptyState =
  | { kind: 'error'; title: string; body: string; action: string }
  | { kind: 'following-no-posts'; title: string; body: string; action: string }
  | { kind: 'new-user'; title: string; body: string }
  | { kind: 'loading' };

/**
 * Picks which state the feed's empty area should render.
 *
 * - While the initial fetch is in flight the component renders the
 *   skeletons instead, so this returns `{ kind: 'loading' }`.
 * - A failed feed query shows the error state with Retry. The component
 *   only asks when it has no posts to show, so a failed background refetch
 *   over a cached feed keeps the feed on screen.
 * - Otherwise it branches on `hasFollows`: "Nothing new yet" with Explore,
 *   or the new-user welcome that leads into the suggestions.
 */
export const getHomeEmptyState = (
  isLoading: boolean,
  hasFollows: boolean,
  isError = false,
): HomeEmptyState => {
  if (isLoading) return { kind: 'loading' };
  if (isError) {
    return {
      kind: 'error',
      title: HOME_FEED_ERROR_TITLE,
      body: HOME_FEED_ERROR_BODY,
      action: HOME_FEED_ERROR_ACTION,
    };
  }
  if (hasFollows) {
    return {
      kind: 'following-no-posts',
      title: HOME_EMPTY_FOLLOWING_TITLE,
      body: HOME_EMPTY_FOLLOWING_BODY,
      action: HOME_EMPTY_FOLLOWING_ACTION,
    };
  }
  return {
    kind: 'new-user',
    title: HOME_EMPTY_NEW_USER_TITLE,
    body: HOME_EMPTY_NEW_USER_BODY,
  };
};

/**
 * The two header action slots rendered on the right side of the screen
 * header (bell and send icons), in the order they appear. Centralising the
 * target routes — `/notifications` and `/messages` — and the accessibility
 * labels keeps the navigation contract visible to the test suite.
 */
export const HOME_HEADER_ACTIONS = [
  { key: 'notifications' as const, target: '/notifications' as const, icon: 'bell' as const, label: 'Notifications' as const },
  { key: 'messages' as const, target: '/messages' as const, icon: 'send' as const, label: 'Messages' as const },
];
export type HomeHeaderActionKey = (typeof HOME_HEADER_ACTIONS)[number]['key'];

/**
 * Returns the navigation target for a header action. The component
 * uses an `onPress` per icon and pushes the matching route; this
 * helper is a single source of truth so the test can pin both routes
 * without snapshotting the whole JSX.
 */
export const getHomeHeaderTarget = (key: HomeHeaderActionKey): string => {
  const match = HOME_HEADER_ACTIONS.find(action => action.key === key);
  // `match` is guaranteed non-undefined because `HomeHeaderActionKey`
  // is the union of the action keys, but we still guard for safety.
  return match ? match.target : '/';
};

/**
 * The accessibility label for a header action, with its unread count when
 * there is one: "Notifications, 3 unread".
 */
export const getHomeHeaderLabel = (key: HomeHeaderActionKey, unread: number): string => {
  const match = HOME_HEADER_ACTIONS.find(action => action.key === key);
  const base = match ? match.label : key;
  return unread > 0 ? `${base}, ${unread} unread` : base;
};
