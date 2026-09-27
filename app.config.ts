// The Expo config: app.json, plus the universal-link setup (ONE-31).
//
// iOS universal links and Android App Links open the app only for a host it
// declares: `applinks:<host>` in the iOS entitlements, and an auto-verified
// intent filter on Android. That host has to be the tag host that
// lib/tagLinks.ts builds every printed URL from. A mismatch disables universal
// links without a word: no build error, nothing on the device. So the host is
// not written out in app.json. It is derived here from the same
// EXPO_PUBLIC_TAG_BASE_URL, and __tests__/appConfig.test.ts pins that the two
// agree for any value.
//
// Expo evaluates this file in Node, where the app's TypeScript modules can't
// be imported, so `tagHost` mirrors lib/tagLinks.ts's `resolveTagBaseUrl` and
// the test compares them.
//
// Only /t/ opens the app. Every other link the app shares uses the custom
// scheme (`onetag://product/<id>`, `onetag://reset-password`), which Expo
// registers from app.json's `scheme` on both platforms. That custom scheme is
// the fallback when universal links are unverified, and it is what the in-app
// scanner routes through.

import type { ConfigContext, ExpoConfig } from 'expo/config';

/** Mirrors `DEFAULT_TAG_BASE_URL` in lib/tagLinks.ts. */
const DEFAULT_TAG_BASE_URL = 'https://onetag.app';

/** Mirrors `TAG_PATH_PREFIX` in lib/tagLinks.ts: tags live at `/t/<code>`. */
const TAG_PATH = '/t/';

/** The tag host, from EXPO_PUBLIC_TAG_BASE_URL as lib/tagLinks.ts reads it. */
export const tagHost = (configured: string | undefined): string =>
  new URL((configured?.trim() || DEFAULT_TAG_BASE_URL).replace(/\/+$/, '')).hostname;

/**
 * `config` with universal links for the tag host added to both platforms.
 *
 * The Android filter names only https. A custom scheme in the same filter
 * would stop it verifying on Android 11 and earlier, which verify only filters
 * that handle web URLs and nothing else.
 */
export const withTagLinks = (config: ExpoConfig, configuredBaseUrl: string | undefined): ExpoConfig => {
  const host = tagHost(configuredBaseUrl);
  return {
    ...config,
    ios: {
      ...config.ios,
      associatedDomains: [...(config.ios?.associatedDomains ?? []), `applinks:${host}`],
    },
    android: {
      ...config.android,
      intentFilters: [
        ...(config.android?.intentFilters ?? []),
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host, pathPrefix: TAG_PATH }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
  };
};

export default ({ config }: ConfigContext): ExpoConfig =>
  withTagLinks(config as ExpoConfig, process.env.EXPO_PUBLIC_TAG_BASE_URL);
