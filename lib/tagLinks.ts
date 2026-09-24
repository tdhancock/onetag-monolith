// The one place a Tag URL is built or read.
//
// Every Physical Tag encodes `https://<domain>/t/<short_code>`, and that URL
// is printed onto stickers. Once a sticker exists its URL cannot change, so
// the domain lives here and nowhere else: QR generation, the share sheet, the
// resolution route and the web surface all import from this module. Changing
// the domain is a one-line edit — until the first sticker is printed, after
// which it must never change at all.
//
// The production domain is not decided yet (`onetag.app` vs `onetag.co`), so
// it comes from `EXPO_PUBLIC_TAG_BASE_URL`, with `https://onetag.app` as the
// development default. Expo inlines `EXPO_PUBLIC_*` at build time.

/** The path segment in front of every short code: `/t/<code>`. */
export const TAG_PATH_PREFIX = 't';

/** The app's custom URL scheme (app.json `scheme`), for `onetag://t/<code>`. */
export const APP_SCHEME = 'onetag';

/**
 * The characters a short code is drawn from.
 *
 * Letters and digits without `0`, `O`, `1`, `I` and `l`: codes are printed on
 * stickers and read back by people, and glyphs that look alike turn into
 * support tickets. The database generator (`public.gen_short_code()`, ONE-27)
 * must draw from exactly this set.
 */
export const TAG_SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Every short code is exactly this long. */
export const TAG_SHORT_CODE_LENGTH = 8;

const DEFAULT_TAG_BASE_URL = 'https://onetag.app';

/** Resolve the configured base URL, without a trailing slash. */
export const resolveTagBaseUrl = (configured: string | undefined): string =>
  (configured?.trim() || DEFAULT_TAG_BASE_URL).replace(/\/+$/, '');

/** The base every Tag URL is built from. */
export const TAG_BASE_URL = resolveTagBaseUrl(process.env.EXPO_PUBLIC_TAG_BASE_URL);

const SHORT_CODE_PATTERN = new RegExp(`^[${TAG_SHORT_CODE_ALPHABET}]{${TAG_SHORT_CODE_LENGTH}}$`);

/** True when a string has the shape of a short code the database could have issued. */
export const isValidShortCode = (code: string): boolean => SHORT_CODE_PATTERN.test(code);

/** The URL printed onto a Tag, or shared as a Digital Tag. */
export const buildTagUrl = (shortCode: string): string =>
  `${TAG_BASE_URL}/${TAG_PATH_PREFIX}/${shortCode}`;

export interface ParsedTagUrl {
  shortCode: string;
}

/**
 * Read a short code out of a URL, or return null.
 *
 * A QR code is attacker-controlled input — anyone can print one — so this
 * accepts exactly two forms and rejects everything else:
 *
 *   https://<the configured host>/t/<code>   the universal link
 *   onetag://t/<code>                        the custom scheme
 *
 * A trailing slash, a query string or a fragment is tolerated, and the host is
 * compared without regard to case. Any other host, scheme or path shape is
 * rejected, and so is a code that is not exactly eight characters from the
 * unambiguous alphabet — before it can reach a query.
 */
export const parseTagUrl = (url: string, baseUrl: string = TAG_BASE_URL): ParsedTagUrl | null => {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url.trim());
    base = new URL(baseUrl);
  } catch {
    return null;
  }

  let segments: string[];

  if (parsed.protocol === `${APP_SCHEME}:`) {
    // `onetag://t/CODE` parses with host "t" and path "/CODE".
    segments = [parsed.hostname, ...parsed.pathname.split('/')].filter(Boolean);
  } else if (
    parsed.protocol === base.protocol &&
    parsed.hostname.toLowerCase() === base.hostname.toLowerCase() &&
    parsed.port === base.port
  ) {
    segments = parsed.pathname.split('/').filter(Boolean);
  } else {
    return null;
  }

  if (segments.length !== 2 || segments[0].toLowerCase() !== TAG_PATH_PREFIX) return null;

  const shortCode = segments[1];
  return isValidShortCode(shortCode) ? { shortCode } : null;
};
