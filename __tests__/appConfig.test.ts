//
// target: __tests__/appConfig.test.ts
//
// Universal links (ONE-31). The OS opens the app for a tag link only when the
// host the app declares (iOS `applinks:`, the Android auto-verified intent
// filter) is the tag host every sticker is printed with. app.config.ts derives
// that host from EXPO_PUBLIC_TAG_BASE_URL, and these pin that it derives the
// same host as lib/tagLinks.ts for any value: a mismatch fails silently, on
// the device, with nothing in any log.

import * as fs from 'fs';
import * as path from 'path';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import appConfig, { tagHost, withTagLinks } from '../app.config';
import { APP_SCHEME, TAG_PATH_PREFIX, resolveTagBaseUrl } from '../lib/tagLinks';

/** app.json's `expo` object: what Expo hands app.config.ts as `config`. */
const staticConfig = (): ExpoConfig =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8')).expo;

const verifiedFilters = (config: ExpoConfig) =>
  (config.android?.intentFilters ?? []).filter((filter) => filter.autoVerify);

const BASE_URLS: (string | undefined)[] = [
  undefined,
  '',
  '   ',
  'https://onetag.app',
  'https://onetag.co/',
  'https://OneTag.CO//',
  'https://tags.example.test',
];

describe('the tag host', () => {
  it.each(BASE_URLS)("is lib/tagLinks.ts's host for %p", (configured) => {
    expect(tagHost(configured)).toBe(new URL(resolveTagBaseUrl(configured)).hostname);
  });
});

describe('iOS', () => {
  it.each(BASE_URLS)('declares applinks for the tag host, for %p', (configured) => {
    expect(withTagLinks(staticConfig(), configured).ios?.associatedDomains).toEqual([
      `applinks:${tagHost(configured)}`,
    ]);
  });

  // The keyboard handling assumes a page sheet reaches the bottom of the
  // screen, as on an iPhone; on an iPad it floats mid-screen. The app is
  // built for phones.
  it('runs on iPhone only', () => {
    expect(staticConfig().ios?.supportsTablet).toBe(false);
  });
});

describe('Android', () => {
  it('verifies one filter: https on the tag host, for /t/ alone', () => {
    expect(verifiedFilters(withTagLinks(staticConfig(), undefined))).toEqual([
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'onetag.app', pathPrefix: `/${TAG_PATH_PREFIX}/` }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ]);
  });

  it.each(BASE_URLS)('follows the tag host, for %p', (configured) => {
    const [filter] = verifiedFilters(withTagLinks(staticConfig(), configured));
    expect(filter.data).toEqual([{ scheme: 'https', host: tagHost(configured), pathPrefix: '/t/' }]);
  });

  // KeyboardAvoider makes room for the keyboard itself. "pan" slid the whole
  // window up on top of that, hiding headers and doubling the space.
  it('lets the keyboard resize the window rather than pan it', () => {
    expect(staticConfig().android?.softwareKeyboardLayoutMode).toBe('resize');
  });
});

describe('the custom scheme', () => {
  it('stays registered: the fallback when universal links are unverified, and what the scanner uses', () => {
    expect(withTagLinks(staticConfig(), undefined).scheme).toBe(APP_SCHEME);
  });
});

describe('app.config.ts', () => {
  const withEnv = (value: string, run: () => void) => {
    const previous = process.env.EXPO_PUBLIC_TAG_BASE_URL;
    process.env.EXPO_PUBLIC_TAG_BASE_URL = value;
    try {
      run();
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_TAG_BASE_URL;
      else process.env.EXPO_PUBLIC_TAG_BASE_URL = previous;
    }
  };

  it('reads EXPO_PUBLIC_TAG_BASE_URL, the variable the app builds tag URLs from', () => {
    withEnv('https://onetag.co', () => {
      const config = appConfig({ config: staticConfig() } as ConfigContext);
      expect(config.ios?.associatedDomains).toEqual(['applinks:onetag.co']);
      expect(verifiedFilters(config)[0].data).toEqual([{ scheme: 'https', host: 'onetag.co', pathPrefix: '/t/' }]);
    });
  });

  it('keeps the rest of app.json', () => {
    const config = appConfig({ config: staticConfig() } as ConfigContext);
    expect(config.name).toBe('OneTag');
    expect(config.ios?.bundleIdentifier).toBe('com.onetag.app');
    expect(config.android?.package).toBe('com.onetag.app');
  });

  it('is the only place universal links are declared', () => {
    const expo = staticConfig();
    expect(expo.ios?.associatedDomains).toBeUndefined();
    expect(expo.android?.intentFilters).toBeUndefined();
  });
});
