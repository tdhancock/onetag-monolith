// Not a route: expo-router's hook for rewriting a link before it is routed
// (https://docs.expo.dev/router/advanced/native-intent/).
//
// Started cold from a tag's Expo Go link, the app opened on Home: expo-router
// treated the launch URL as "open the project" and handed this hook the root
// instead of /t/<code>. So the first link reads the launch URL itself, and
// routes to its `/--/` path when it has one. Everything else passes through.

import { getLinkingURL } from 'expo-linking';
import { expoGoLinkPath } from '../lib/expoGoLink';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  if (!initial) return path;
  return expoGoLinkPath(getLinkingURL()) ?? path;
}
