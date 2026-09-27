// The tag host's web surface (ONE-36): everything tag-resolve does, kept free
// of Deno so Jest can run it. index.ts wires it to Supabase and serves it.
//
// A Physical Tag is a sticker, and whoever scans it with a phone camera
// usually doesn't have OneTag. Their browser opens https://<tag host>/t/<code>,
// and this answers with a landing page: what the tag points to, a way into the
// app, and the store listings. With the app installed, the OS opens it before
// the browser gets here (universal links, ONE-31). When it doesn't, the page's
// button deep-links. Web is a thin surface, not a port: the page names the
// Destination and links onward. It never reproduces it.
//
// The page is one self-contained HTML document: inline CSS, no script, no
// client-side fetching. The host also serves the two well-known files the OS
// reads before trusting the app with /t/ links.

// ─── Tag links: a mirror of lib/tagLinks.ts ─────────────────────────────
//
// Deno can't import the app's TypeScript, so the rules a tag URL follows are
// copied here, and lib/tagLinks.ts points back at this file. Two copies of a
// validation rule drift, so __tests__/supabase/tagResolve.test.ts pins every
// value and behaviour below to the original.

/** Mirrors `TAG_PATH_PREFIX`: tags live at `/t/<code>`. */
export const TAG_PATH_PREFIX = 't';

/** Mirrors `APP_SCHEME`, app.json's `scheme`. */
export const APP_SCHEME = 'onetag';

/** Mirrors `TAG_SHORT_CODE_ALPHABET`: no 0, O, 1, I or l. */
export const TAG_SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Mirrors `TAG_SHORT_CODE_LENGTH`. */
export const TAG_SHORT_CODE_LENGTH = 8;

const DEFAULT_TAG_BASE_URL = 'https://onetag.app';

const SHORT_CODE_PATTERN = new RegExp(`^[${TAG_SHORT_CODE_ALPHABET}]{${TAG_SHORT_CODE_LENGTH}}$`);

/** Mirrors `isValidShortCode`. */
export const isValidShortCode = (code: string): boolean => SHORT_CODE_PATTERN.test(code);

/** Mirrors `resolveTagBaseUrl`: the configured base, without a trailing slash. */
export const resolveTagBaseUrl = (configured: string | undefined): string =>
  (configured?.trim() || DEFAULT_TAG_BASE_URL).replace(/\/+$/, '');

/** Mirrors `buildTagUrl`, from a given base. */
export const buildTagUrl = (baseUrl: string, shortCode: string): string =>
  `${baseUrl}/${TAG_PATH_PREFIX}/${shortCode}`;

// ─── The app and its store listings ─────────────────────────────────────

/** app.json's `ios.bundleIdentifier` and `android.package`. */
export const APP_ID = 'com.onetag.app';

/**
 * The App Store listing's numeric id, from App Store Connect, once there is
 * one. Until then the page offers Google Play alone, rather than a link to
 * nowhere.
 */
export const APP_STORE_ID: string | null = null;

export interface Link {
  label: string;
  href: string;
}

/** The store listings, the visitor's own platform first. */
export const storeLinks = (appStoreId: string | null, android: boolean): Link[] => {
  const play: Link = { label: 'Google Play', href: `https://play.google.com/store/apps/details?id=${APP_ID}` };
  if (!appStoreId) return [play];
  const appStore: Link = { label: 'App Store', href: `https://apps.apple.com/app/id${appStoreId}` };
  return android ? [play, appStore] : [appStore, play];
};

/**
 * The app, opened at a tag's route, or at its start for a code that isn't one.
 *
 * Chrome on Android opens an `intent:` URL in the app when it is installed and
 * at its Play listing when it isn't, with no error either way. Elsewhere it's
 * the custom scheme, followed only when someone taps it. Opening it on load
 * would show iOS Safari's "address is invalid" alert to everyone without the
 * app, and universal links have already opened the app for everyone with it.
 */
export const appLink = (shortCode: string | null, android: boolean): string => {
  const path = shortCode ? `${TAG_PATH_PREFIX}/${shortCode}` : '';
  return android
    ? `intent://${path}#Intent;scheme=${APP_SCHEME};package=${APP_ID};end`
    : `${APP_SCHEME}://${path}`;
};

// ─── The well-known files (ONE-31) ──────────────────────────────────────
//
// The same documents as public/.well-known/, where docs/deep-links.md explains
// them; the test fails if the two differ. The Team ID and the fingerprints
// are placeholders until the owner's accounts supply them. Both platforms
// ignore a file that is redirected, has the wrong type or can't be parsed,
// and say nothing, so these go out as plain `application/json`, never
// redirected.

export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    details: [
      {
        appIDs: [`APPLE_TEAM_ID.${APP_ID}`],
        components: [
          {
            '/': `/${TAG_PATH_PREFIX}/*`,
            comment: 'A Tag: /t/<short code>. Nothing else on the tag host opens the app.',
          },
        ],
      },
    ],
  },
};

export const ASSET_LINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: APP_ID,
      sha256_cert_fingerprints: ['PLAY_APP_SIGNING_KEY_SHA256', 'EAS_UPLOAD_KEY_SHA256'],
    },
  },
];

const WELL_KNOWN = new Map<string, unknown>([
  ['apple-app-site-association', APPLE_APP_SITE_ASSOCIATION],
  ['assetlinks.json', ASSET_LINKS],
]);

// ─── What the function reads ────────────────────────────────────────────

/** A row of `public.resolve_tag(p_short_code)`, as in features/tags/types.ts. */
export interface ResolveTagRow {
  /** Null unless the tag is active. */
  tag_id: string | null;
  active: boolean;
  dest_profile_id: string | null;
  dest_profile_username: string | null;
  dest_product_id: string | null;
  dest_project_id: string | null;
}

/** A name to show for a profile: the full name, or the handle. */
interface ProfileName {
  username: string;
  full_name: string | null;
}

export interface ProfileRow extends ProfileName {
  avatar_url: string | null;
  profile_type: 'individual' | 'business';
}

export interface ProductRow {
  name: string;
  /** A one-to-one embed arrives as an object; an older server may send an array. */
  business: ProfileName | ProfileName[] | null;
  product_media: { url: string; media_type: string; sort_order: number }[] | null;
}

export interface ProjectRow {
  name: string;
  cover_url: string | null;
  owner: ProfileName | ProfileName[] | null;
}

// The select strings index.ts reads with, here beside the row types they fill.
// The owner embeds name the column they follow: projects and profiles are also
// linked through contributors.
export const PROFILE_COLUMNS = 'username, full_name, avatar_url, profile_type';
export const PRODUCT_COLUMNS =
  'name, business:profiles!business_profile_id(username, full_name), product_media(url, media_type, sort_order)';
export const PROJECT_COLUMNS = 'name, cover_url, owner:profiles!owner_profile_id(username, full_name)';

/**
 * Where tag-resolve reads and writes. index.ts implements it with the anon
 * key and no session, so RLS decides what a stranger sees, exactly as for a
 * signed-out visitor in the app: the tag through `resolve_tag` (ONE-82), the
 * Destination through its public read, and the scan through the anonymous
 * insert. A read resolves to null when the row isn't there for a stranger,
 * whether it is gone or private.
 */
export interface TagSource {
  resolveTag(shortCode: string): Promise<ResolveTagRow | null>;
  readProfile(profileId: string): Promise<ProfileRow | null>;
  readProduct(productId: string): Promise<ProductRow | null>;
  readProject(projectId: string): Promise<ProjectRow | null>;
  recordScan(tagId: string): Promise<void>;
}

// ─── Destinations ───────────────────────────────────────────────────────

type DestinationRef =
  | { kind: 'profile'; id: string }
  | { kind: 'product'; id: string }
  | { kind: 'project'; id: string };

/** Where a live tag points, as the app's features/tags/api.ts reads it, or null. */
const destinationOf = (row: ResolveTagRow): DestinationRef | null => {
  if (row.dest_profile_id) return row.dest_profile_username ? { kind: 'profile', id: row.dest_profile_id } : null;
  if (row.dest_product_id) return { kind: 'product', id: row.dest_product_id };
  if (row.dest_project_id) return { kind: 'project', id: row.dest_project_id };
  return null;
};

/** A Destination as the page shows it. */
export interface DestinationCard {
  /** Business Profile, Individual Profile, Product or Project. */
  kindLabel: string;
  name: string;
  /** Whose it is: a profile's handle, or who lists the product or runs the project. */
  byline: string | null;
  image: { url: string; shape: 'avatar' | 'cover' } | null;
}

const one = <T>(embed: T | T[] | null | undefined): T | null =>
  Array.isArray(embed) ? embed[0] ?? null : embed ?? null;

const displayName = (profile: ProfileName): string => profile.full_name?.trim() || `@${profile.username}`;

/** An image URL a page may load: http or https, nothing else. */
export const safeImageUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
};

export const profileCard = (profile: ProfileRow): DestinationCard => {
  const avatar = safeImageUrl(profile.avatar_url);
  return {
    kindLabel: profile.profile_type === 'business' ? 'Business Profile' : 'Individual Profile',
    name: displayName(profile),
    byline: profile.full_name?.trim() ? `@${profile.username}` : null,
    image: avatar ? { url: avatar, shape: 'avatar' } : null,
  };
};

export const productCard = (product: ProductRow): DestinationCard => {
  const business = one(product.business);
  // A product's representative image is its first photo by sort order.
  const photo = [...(product.product_media ?? [])]
    .filter((media) => media.media_type === 'photo')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((media) => safeImageUrl(media.url))
    .find((url): url is string => url !== null);
  return {
    kindLabel: 'Product',
    name: product.name,
    byline: business ? `by ${displayName(business)}` : null,
    image: photo ? { url: photo, shape: 'cover' } : null,
  };
};

export const projectCard = (project: ProjectRow): DestinationCard => {
  const owner = one(project.owner);
  const cover = safeImageUrl(project.cover_url);
  return {
    kindLabel: 'Project',
    name: project.name,
    byline: owner ? `by ${displayName(owner)}` : null,
    image: cover ? { url: cover, shape: 'cover' } : null,
  };
};

const readCard = async (ref: DestinationRef, source: TagSource): Promise<DestinationCard | null> => {
  switch (ref.kind) {
    case 'profile': {
      const row = await source.readProfile(ref.id);
      return row ? profileCard(row) : null;
    }
    case 'product': {
      const row = await source.readProduct(ref.id);
      return row ? productCard(row) : null;
    }
    case 'project': {
      const row = await source.readProject(ref.id);
      return row ? projectCard(row) : null;
    }
  }
};

/** Enough to point the way when a Destination's details couldn't be read. */
const unreadCard = (ref: DestinationRef): DestinationCard => ({
  kindLabel: ref.kind === 'profile' ? 'Profile' : ref.kind === 'product' ? 'Product' : 'Project',
  name: 'Open this tag in OneTag',
  byline: null,
  image: null,
});

// ─── Who is reading ─────────────────────────────────────────────────────

/**
 * Link-preview fetchers and crawlers. Messaging and social apps fetch a pasted
 * link to unfurl it, and that is nobody reading the tag, so it records no
 * Scan. Named one by one: a bare "bot" would also match phones like the Cubot.
 */
const NOT_A_PERSON =
  /facebookexternalhit|Facebot|Twitterbot|Slackbot|Discordbot|TelegramBot|WhatsApp|LinkedInBot|SkypeUriPreview|Pinterestbot|redditbot|Applebot|Googlebot|bingbot|DuckDuckBot|YandexBot|Baiduspider|Embedly|Iframely|vkShare|Mastodon|Bluesky|Snap URL Preview|Google-PageRenderer|Google-InspectionTool|HeadlessChrome/i;

/** Whether a request is a person reading the tag, as opposed to a preview, a crawler or a prefetch. */
export const isPersonReading = (request: Request): boolean => {
  if (request.method !== 'GET') return false;
  const purpose = `${request.headers.get('sec-purpose') ?? ''} ${request.headers.get('purpose') ?? ''}`;
  if (/prefetch|prerender/i.test(purpose)) return false;
  return !NOT_A_PERSON.test(request.headers.get('user-agent') ?? '');
};

const isAndroid = (request: Request): boolean => /Android/i.test(request.headers.get('user-agent') ?? '');

// ─── Routing ────────────────────────────────────────────────────────────

/** The function's own name, in front of the path when it is called at /functions/v1/tag-resolve/. */
const FUNCTION_NAME = 'tag-resolve';

export type Route =
  | { kind: 'well-known'; file: string }
  /** A tag path. The code is exactly what the path held, and may not be a code at all. */
  | { kind: 'tag'; code: string }
  | { kind: 'none' };

/**
 * What a request path asks for. A tag path takes `parseTagUrl`'s shape: the
 * prefix in any case, then exactly one segment, with a trailing slash
 * tolerated. The segment stays percent-encoded, so an encoded character is
 * never a valid code.
 */
export const routeFor = (pathname: string): Route => {
  let segments = pathname.split('/').filter(Boolean);
  if (segments[0] === FUNCTION_NAME) segments = segments.slice(1);

  if (segments.length === 2 && segments[0] === '.well-known' && WELL_KNOWN.has(segments[1])) {
    return { kind: 'well-known', file: segments[1] };
  }
  if (segments.length > 0 && segments[0].toLowerCase() === TAG_PATH_PREFIX) {
    return { kind: 'tag', code: segments.length === 2 ? segments[1] : '' };
  }
  return { kind: 'none' };
};

// ─── The page ───────────────────────────────────────────────────────────

export type TagFailure = 'not-found' | 'inactive' | 'failed' | 'destination-missing';

/**
 * The in-app route's copy for the same failures, word for word:
 * lib/screens/tagResolution.ts's FAILURE_COPY, pinned by the test. Its
 * `offline` state has no counterpart here: a page that arrived is online.
 */
export const FAILURE_COPY: Record<TagFailure, { label: string; title: string; body: string }> = {
  'not-found': {
    label: 'Unknown tag',
    title: "This tag isn't recognized.",
    body: 'Check the code, or see what else is on OneTag.',
  },
  inactive: {
    label: 'Tag paused',
    title: 'This tag is no longer active.',
    body: 'Its owner has paused or replaced it.',
  },
  failed: {
    label: 'Something went wrong',
    title: "This tag didn't open.",
    body: 'OneTag had trouble reading it. Try again in a moment.',
  },
  'destination-missing': {
    label: 'Destination gone',
    title: 'What this tag pointed to is gone.',
    body: 'It may have been removed. There is still plenty on OneTag.',
  },
};

/** 404 for a code that isn't there, 410 for a tag that was, 503 when the database couldn't say. */
const FAILURE_STATUS: Record<TagFailure, number> = {
  'not-found': 404,
  inactive: 410,
  failed: 503,
  'destination-missing': 410,
};

export interface Page {
  status: number;
  /** The page's title, and what a link preview shows. */
  title: string;
  description: string;
  /** The tag's own URL, for canonical and og:url. Null when the path held no valid code. */
  url: string | null;
  /** The micro-label over the heading. */
  label: string;
  heading: string;
  byline: string | null;
  body: string | null;
  image: DestinationCard['image'];
  /** The first letter of the name, standing in for a missing avatar. */
  initial: string | null;
  actions: Link[];
  stores: Link[];
}

interface PageContext {
  code: string | null;
  url: string | null;
  android: boolean;
  appStoreId: string | null;
}

const destinationPage = (card: DestinationCard, context: PageContext): Page => ({
  status: 200,
  title: card.name,
  description: `${card.kindLabel}${card.byline ? ` ${card.byline}` : ''} on OneTag`,
  url: context.url,
  label: card.kindLabel,
  heading: card.name,
  byline: card.byline,
  body: null,
  image: card.image,
  initial: card.image ? null : card.name.replace(/^@/, '').charAt(0).toUpperCase() || null,
  actions: [{ label: 'Open in OneTag', href: appLink(context.code, context.android) }],
  stores: storeLinks(context.appStoreId, context.android),
});

/** A failure, with somewhere to go next: the app, the stores, or another try. */
const failurePage = (failure: TagFailure, context: PageContext): Page => {
  const copy = FAILURE_COPY[failure];
  const open: Link = { label: 'Open OneTag', href: appLink(context.code, context.android) };
  return {
    status: FAILURE_STATUS[failure],
    title: copy.title,
    description: copy.body,
    url: context.url,
    label: context.code ? `${copy.label} · ${context.code}` : copy.label,
    heading: copy.title,
    byline: null,
    body: copy.body,
    image: null,
    initial: null,
    actions: failure === 'failed' && context.url ? [{ label: 'Try again', href: context.url }, open] : [open],
    stores: storeLinks(context.appStoreId, context.android),
  };
};

// ─── Handling a request ─────────────────────────────────────────────────

export interface HandlerDeps {
  source: TagSource;
  /** The function's TAG_BASE_URL secret: the same value as the app's EXPO_PUBLIC_TAG_BASE_URL. */
  tagBaseUrl?: string;
  /** Keeps work running after the response is sent: EdgeRuntime.waitUntil. */
  waitUntil: (work: Promise<unknown>) => void;
  /** Where a failed read or scan is reported. */
  log?: (message: string, error: unknown) => void;
  /** Defaults to APP_STORE_ID. */
  appStoreId?: string | null;
}

/**
 * Record a Scan without holding up the page: started now, handed to
 * `waitUntil`, never awaited. A slow insert or a failed one changes nothing
 * the visitor sees.
 */
const recordScanInBackground = (tagId: string, deps: HandlerDeps): void => {
  const work = Promise.resolve()
    .then(() => deps.source.recordScan(tagId))
    .catch((error: unknown) => deps.log?.('tag-resolve: recording a scan failed', error));
  try {
    deps.waitUntil(work);
  } catch (error) {
    deps.log?.('tag-resolve: waitUntil failed', error);
  }
};

/** The page for a tag path: resolve, record the Scan, and describe the Destination. */
export const tagPage = async (code: string, request: Request, deps: HandlerDeps): Promise<Page> => {
  const valid = isValidShortCode(code);
  const context: PageContext = {
    code: valid ? code : null,
    url: valid ? buildTagUrl(resolveTagBaseUrl(deps.tagBaseUrl), code) : null,
    android: isAndroid(request),
    appStoreId: deps.appStoreId === undefined ? APP_STORE_ID : deps.appStoreId,
  };

  // The path came from a URL anyone can print on a sticker. A code that isn't
  // the shape of one the database issues never reaches a query.
  if (!valid) return failurePage('not-found', context);

  let row: ResolveTagRow | null;
  try {
    row = await deps.source.resolveTag(code);
  } catch (error) {
    deps.log?.('tag-resolve: resolve_tag failed', error);
    return failurePage('failed', context);
  }
  if (!row) return failurePage('not-found', context);
  if (!row.active || !row.tag_id) return failurePage('inactive', context);

  const ref = destinationOf(row);
  if (!ref) return failurePage('destination-missing', context);

  // A live tag was read. As in the app, that is a Scan even when the
  // Destination then turns out to be private.
  if (isPersonReading(request)) recordScanInBackground(row.tag_id, deps);

  let card: DestinationCard | null;
  try {
    card = await readCard(ref, deps.source);
  } catch (error) {
    // The tag is fine, so the way into the app still is: offer it without the details.
    deps.log?.('tag-resolve: reading the destination failed', error);
    card = unreadCard(ref);
  }
  return card ? destinationPage(card, context) : failurePage('destination-missing', context);
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/**
 * No script at all. Styles are inline, fonts come from Google Fonts, and images
 * from wherever the Destination's are stored.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  'img-src https: http:',
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const respond = (status: number, body: string, headers: Record<string, string>, head: boolean): Response =>
  new Response(head ? null : body, { status, headers: { ...SECURITY_HEADERS, ...headers } });

/**
 * Answer a request to the tag host: a tag page, or a well-known file.
 *
 * Tag pages are never cached. Each one records a Scan, and a tag can be
 * paused at any moment.
 */
export const handleRequest = async (request: Request, deps: HandlerDeps): Promise<Response> => {
  const head = request.method === 'HEAD';
  if (request.method !== 'GET' && !head) {
    return respond(405, 'Method not allowed', { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }, false);
  }

  const route = routeFor(new URL(request.url).pathname);

  if (route.kind === 'well-known') {
    return respond(
      200,
      `${JSON.stringify(WELL_KNOWN.get(route.file), null, 2)}\n`,
      { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
      head,
    );
  }

  if (route.kind === 'none') {
    return respond(404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' }, head);
  }

  const page = await tagPage(route.code, request, deps);
  return respond(
    page.status,
    renderPage(page),
    {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': CONTENT_SECURITY_POLICY,
    },
    head,
  );
};

// ─── HTML ───────────────────────────────────────────────────────────────

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for HTML content and quoted attribute values alike. */
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const meta = (attribute: 'name' | 'property', key: string, content: string): string =>
  `<meta ${attribute}="${key}" content="${escapeHtml(content)}">`;

/**
 * Mirrors theme/tokens.ts: `color`, the house type, the micro-label and the
 * Button primitive's two weights. This page can't import the token file, so
 * the handful of values it uses are copied here, the one sanctioned place raw
 * hex appears outside it (ONE-36). The test checks each against the file.
 */
const STYLES = `
:root {
  --bg: #ffffff;
  --bg-panel: #f5f5f5;
  --border: #e8e8e8;
  --text: #0a0a0a;
  --text-mid: #555555;
  --text-muted: #999999;
  --inverse: #ffffff;
  --mono: 'DM Mono', ui-monospace, Menlo, monospace;
  --sans: 'DM Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; }
body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 15px; line-height: 22px; }
.page { display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; max-width: 440px; margin: 0 auto; padding: 16px 16px 24px; }
.label { font-family: var(--mono); font-weight: 500; font-size: 10px; line-height: 14px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-muted); overflow-wrap: anywhere; }
.bar { display: flex; justify-content: space-between; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.brand { color: var(--text); }
.main { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 32px 0; }
.avatar { display: flex; align-items: center; justify-content: center; width: 96px; height: 96px; margin-bottom: 24px; border: 1px solid var(--border); background: var(--bg-panel); object-fit: cover; font-family: var(--mono); font-weight: 500; font-size: 32px; color: var(--text-mid); }
.cover { display: block; width: 100%; aspect-ratio: 4 / 3; margin-bottom: 24px; border: 1px solid var(--border); background: var(--bg-panel); object-fit: cover; }
h1 { margin-top: 12px; font-weight: 700; font-size: 24px; line-height: 30px; overflow-wrap: anywhere; }
.byline { margin-top: 4px; color: var(--text-mid); overflow-wrap: anywhere; }
.body { margin-top: 8px; color: var(--text-mid); }
.actions { display: grid; gap: 12px; margin-top: 24px; }
.button { display: block; padding: 12px 16px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-family: var(--mono); font-weight: 500; font-size: 12px; line-height: 16px; letter-spacing: 0.18em; text-transform: uppercase; text-align: center; text-decoration: none; }
.button.primary { padding: 16px; border-color: var(--text); background: var(--text); color: var(--inverse); }
.button:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.stores { padding-top: 24px; border-top: 1px solid var(--border); }
.stores .label { margin-bottom: 12px; }
.store-links { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
`;

const FONTS = 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@500&family=DM+Sans:wght@400;700&display=swap';

const renderImage = (page: Page): string => {
  if (page.image?.shape === 'cover') return `<img class="cover" src="${escapeHtml(page.image.url)}" alt="">`;
  if (page.image) return `<img class="avatar" src="${escapeHtml(page.image.url)}" alt="" width="96" height="96">`;
  if (page.initial) return `<div class="avatar" aria-hidden="true">${escapeHtml(page.initial)}</div>`;
  return '';
};

const renderLink = (link: Link, className: string): string =>
  `<a class="${className}" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`;

/** The whole document. Every value from the database or the path goes through escapeHtml. */
export const renderPage = (page: Page): string => {
  const image = page.image?.url;
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${escapeHtml(page.title)} · OneTag</title>`,
    meta('name', 'description', page.description),
    // A tag is a portal to something in the app, not a page to be found by searching.
    meta('name', 'robots', 'noindex'),
    page.url ? `<link rel="canonical" href="${escapeHtml(page.url)}">` : '',
    meta('property', 'og:site_name', 'OneTag'),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:title', page.title),
    meta('property', 'og:description', page.description),
    page.url ? meta('property', 'og:url', page.url) : '',
    image ? meta('property', 'og:image', image) : '',
    meta('name', 'twitter:card', page.image?.shape === 'cover' ? 'summary_large_image' : 'summary'),
    meta('name', 'twitter:title', page.title),
    meta('name', 'twitter:description', page.description),
    image ? meta('name', 'twitter:image', image) : '',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${escapeHtml(FONTS)}">`,
    `<style>${STYLES}</style>`,
  ].filter(Boolean);

  const [primary, ...others] = page.actions;
  const body = [
    '<div class="page">',
    '<header class="bar"><span class="label brand">OneTag</span></header>',
    '<main class="main">',
    renderImage(page),
    `<p class="label">${escapeHtml(page.label)}</p>`,
    `<h1>${escapeHtml(page.heading)}</h1>`,
    page.byline ? `<p class="byline">${escapeHtml(page.byline)}</p>` : '',
    page.body ? `<p class="body">${escapeHtml(page.body)}</p>` : '',
    '<nav class="actions">',
    primary ? renderLink(primary, 'button primary') : '',
    ...others.map((link) => renderLink(link, 'button')),
    '</nav>',
    '</main>',
    '<footer class="stores">',
    '<p class="label">Get the OneTag app</p>',
    `<div class="store-links">${page.stores.map((link) => renderLink(link, 'button')).join('')}</div>`,
    '</footer>',
    '</div>',
  ].filter(Boolean);

  return `<!doctype html>\n<html lang="en">\n<head>\n${head.join('\n')}\n</head>\n<body>\n${body.join('\n')}\n</body>\n</html>\n`;
};
