// Back, or home when there is nowhere back to go (ONE-90).
//
// A tag opened from outside the app starts the stack at `/t/<code>`, and
// resolution replaces itself with the Destination (ONE-30) — so a stranger who
// scanned a sticker lands on a profile, product or project with nothing under
// it. `router.back()` would do nothing there, and the header has no Back to
// show. Every Destination screen goes back through this instead: the previous
// screen when there is one, and home when there isn't — the tabs signed in,
// sign-up signed out, the same places a failed tag offers (ONE-30).

import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useAuthStatus } from '../features/auth';
import { onwardActionsFor } from './screens/tagResolution';

export interface BackOrHome {
  /** Whether there is a screen under this one to go back to. */
  canGoBack: boolean;
  /** Go back if there is somewhere to go back to, home if not. */
  goBack: () => void;
}

export const useBackOrHome = (): BackOrHome => {
  const router = useRouter();
  const auth = useAuthStatus();
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(onwardActionsFor(auth).primary.route);
  }, [router, auth]);

  return { canGoBack: router.canGoBack(), goBack };
};
