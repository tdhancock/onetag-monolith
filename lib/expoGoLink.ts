// The route inside a link that opens the app through Expo Go.
//
// Expo Go links carry the app's own path after a `/--/` segment:
// exp://u.expo.dev/<project>/branch/<branch>/--/t/<code> opens /t/<code>.
// A link that starts Expo Go cold can reach the app in its https form,
// https://u.expo.dev/…/--/t/<code>, and expo-router reads a u.expo.dev link
// as "open the project", dropping the path to Home. app/+native-intent.tsx
// takes the path back out with this.
//
// Only Expo Go needs it: a real build opens a tag's link as a universal link,
// whose path is the route.

const EXPO_GO_PATH = /^(?:exps?|https?):\/\/[^/?#]+(?:\/[^?#]*?)?\/--\/([^#]*)$/;

/** The route after `/--/` in an Expo Go link, or null when there isn't one. */
export const expoGoLinkPath = (url: string | null | undefined): string | null => {
  if (!url) return null;
  const path = url.trim().match(EXPO_GO_PATH)?.[1];
  if (!path || path.startsWith('?')) return null;
  return `/${path.replace(/^\/+/, '')}`;
};
