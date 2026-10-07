// Where signing in comes back to (ONE-139).
//
// Signing in from the sign-in screen goes home (app/_layout.tsx). A screen
// that sends someone to sign in for a reason — a blank tag's owner, holding
// it signed out — leaves the route to come back to here first, and the
// layout takes it in place of home, once.
//
// Navigation state no server owns, so it is neither a query nor AppContext's:
// one pending route, held in memory, gone if the app is closed.

let pending: string | null = null;

/** Come back to `route` after the next sign-in, instead of home. */
export const returnAfterSignIn = (route: string): void => {
  pending = route;
};

/** The route to come back to, if one was left — and forget it. */
export const takeReturnAfterSignIn = (): string | null => {
  const route = pending;
  pending = null;
  return route;
};
