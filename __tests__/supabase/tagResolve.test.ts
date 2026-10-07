//
// target: __tests__/supabase/tagResolve.test.ts
//
// The tag host's web surface (ONE-36): supabase/functions/tag-resolve. The
// request handler runs here against a fake data source. What the function
// mirrors from the app (the tag link rules, the failure copy, the token
// colours, the well-known files) is pinned to the original, so the two copies
// can't drift apart.

import * as fs from 'fs';
import * as path from 'path';
import * as tagLinks from '../../lib/tagLinks';
import { FAILURE_COPY as APP_FAILURE_COPY } from '../../lib/screens/tagResolution';
import { color } from '../../theme/tokens';
import {
  APP_ID,
  APP_SCHEME,
  APPLE_APP_SITE_ASSOCIATION,
  ASSET_LINKS,
  FAILURE_COPY,
  TAG_PATH_PREFIX,
  TAG_SHORT_CODE_ALPHABET,
  TAG_SHORT_CODE_LENGTH,
  appLink,
  buildTagUrl,
  escapeHtml,
  handleRequest,
  isPersonReading,
  isValidShortCode,
  resolveTagBaseUrl,
  routeFor,
  safeImageUrl,
  storeLinks,
} from '../../supabase/functions/tag-resolve/handler';
import type {
  HandlerDeps,
  ProductRow,
  ProfileRow,
  ProjectRow,
  ResolveTagRow,
  TagFailure,
  TagSource,
} from '../../supabase/functions/tag-resolve/handler';

const CODE = 'ABC23XYZ';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

const request = (
  pathname: string,
  options: { method?: string; ua?: string; headers?: Record<string, string>; host?: string } = {},
): Request =>
  new Request(`${options.host ?? 'https://onetag.app'}${pathname}`, {
    method: options.method ?? 'GET',
    headers: { 'user-agent': options.ua ?? IPHONE, ...options.headers },
  });

const profileTag: ResolveTagRow = {
  tag_id: 'tag-1',
  active: true,
  dest_profile_id: 'pr-1',
  dest_profile_username: 'acme',
  dest_product_id: null,
  dest_project_id: null,
};
const productTag: ResolveTagRow = { ...profileTag, dest_profile_id: null, dest_profile_username: null, dest_product_id: 'pd-1' };
const projectTag: ResolveTagRow = { ...profileTag, dest_profile_id: null, dest_profile_username: null, dest_project_id: 'pj-1' };
const postTag: ResolveTagRow = {
  ...profileTag,
  dest_profile_id: null,
  dest_profile_username: null,
  dest_post_id: 'po-1',
  dest_post_username: 'jane',
};

const acme: ProfileRow = {
  username: 'acme',
  full_name: 'Acme Woodworks',
  avatar_url: 'https://cdn.example.test/avatars/acme.jpg',
  profile_type: 'business',
};

const oakDoor: ProductRow = {
  name: 'Oak door',
  business: { username: 'acme', full_name: 'Acme Woodworks' },
  product_media: [
    { url: 'https://cdn.example.test/door.mp4', media_type: 'video', sort_order: 0 },
    { url: 'https://cdn.example.test/door-side.jpg', media_type: 'photo', sort_order: 2 },
    { url: 'https://cdn.example.test/door-front.jpg', media_type: 'photo', sort_order: 1 },
  ],
};

const kitchen: ProjectRow = {
  name: 'Kitchen remodel',
  cover_url: 'https://cdn.example.test/kitchen.jpg',
  owner: [{ username: 'jane', full_name: 'Jane Doe' }],
};

/** A data source and the handler's other dependencies, all recorded. */
const setup = (overrides: Partial<TagSource> = {}) => {
  const background: Promise<unknown>[] = [];
  const logged: unknown[] = [];
  const impl: TagSource = {
    resolveTag: async () => profileTag,
    readProfile: async () => acme,
    readProduct: async () => oakDoor,
    readProject: async () => kitchen,
    recordScan: async () => undefined,
    ...overrides,
  };
  const source = {
    resolveTag: jest.fn(impl.resolveTag),
    readProfile: jest.fn(impl.readProfile),
    readProduct: jest.fn(impl.readProduct),
    readProject: jest.fn(impl.readProject),
    recordScan: jest.fn(impl.recordScan),
  };
  const deps: HandlerDeps = {
    source,
    waitUntil: (work) => {
      background.push(work);
    },
    log: (_message, error) => {
      logged.push(error);
    },
  };
  return { source, deps, background, logged };
};

const html = async (response: Response) => {
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  return response.text();
};

const metaContent = (page: string, key: string): string | null => {
  const match = new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`).exec(page);
  return match ? match[1] : null;
};

// ─── The mirror of lib/tagLinks.ts ──────────────────────────────────────

describe('the tag link rules mirror lib/tagLinks.ts', () => {
  it('has the same constants', () => {
    expect(TAG_PATH_PREFIX).toBe(tagLinks.TAG_PATH_PREFIX);
    expect(APP_SCHEME).toBe(tagLinks.APP_SCHEME);
    expect(TAG_SHORT_CODE_ALPHABET).toBe(tagLinks.TAG_SHORT_CODE_ALPHABET);
    expect(TAG_SHORT_CODE_LENGTH).toBe(tagLinks.TAG_SHORT_CODE_LENGTH);
  });

  it.each([
    CODE,
    'abc23xyz',
    TAG_SHORT_CODE_ALPHABET.slice(0, 8),
    TAG_SHORT_CODE_ALPHABET.slice(-8),
    '',
    'ABC23XY',
    'ABC23XYZA',
    'ABC2OXYZ',
    'ABC20XYZ',
    'ABC2lXYZ',
    'ABC2IXYZ',
    'ABC21XYZ',
    'ABC23XY-',
    'ABC23X%20',
    'ABC 23XY',
    '<script>',
  ])('validates %p the same way', (code) => {
    expect(isValidShortCode(code)).toBe(tagLinks.isValidShortCode(code));
  });

  it.each([undefined, '', '   ', 'https://onetag.co/', 'https://onetag.co//'])(
    'resolves the base URL %p the same way',
    (configured) => {
      expect(resolveTagBaseUrl(configured)).toBe(tagLinks.resolveTagBaseUrl(configured));
    },
  );

  it('builds the same tag URL', () => {
    expect(buildTagUrl(tagLinks.TAG_BASE_URL, CODE)).toBe(tagLinks.buildTagUrl(CODE));
  });

  it.each([
    '/t/ABC23XYZ',
    '/t/ABC23XYZ/',
    '/T/ABC23XYZ',
    '/t/abc23xyz',
    '/t//ABC23XYZ',
    '/t/ABC23XYZ?utm_source=sticker',
    '/t/ABC23XYZ#top',
    '/t/',
    '/t',
    '/t/ABC23XYZ/extra',
    '/x/t/ABC23XYZ',
    '/post/ABC23XYZ',
    '/t/ABC23X%20',
    '/t/ABC2OXYZ',
    '/t/ABC23XY',
  ])('reads a code from %p exactly when parseTagUrl does', (pathAndQuery) => {
    const url = `${tagLinks.TAG_BASE_URL}${pathAndQuery}`;
    const route = routeFor(new URL(url).pathname);
    const code = route.kind === 'tag' && isValidShortCode(route.code) ? route.code : null;
    expect(code).toBe(tagLinks.parseTagUrl(url)?.shortCode ?? null);
  });

  it("also answers under the function's own name, as it does when called at /functions/v1/tag-resolve", () => {
    expect(routeFor(`/tag-resolve/t/${CODE}`)).toEqual({ kind: 'tag', code: CODE });
    expect(routeFor('/tag-resolve/.well-known/assetlinks.json')).toEqual({ kind: 'well-known', file: 'assetlinks.json' });
  });
});

describe('the app it opens', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'app.json'), 'utf8')).expo;

  it("is app.json's bundle identifier and package", () => {
    expect(APP_ID).toBe(appJson.ios.bundleIdentifier);
    expect(APP_ID).toBe(appJson.android.package);
  });

  it("opens a tag's route on the custom scheme, or an Android intent that falls back to Play", () => {
    expect(appLink(CODE, false)).toBe('onetag://t/ABC23XYZ');
    expect(appLink(CODE, true)).toBe('intent://t/ABC23XYZ#Intent;scheme=onetag;package=com.onetag.app;end');
  });

  it('opens the app at its start when there is no code', () => {
    expect(appLink(null, false)).toBe('onetag://');
    expect(appLink(null, true)).toBe('intent://#Intent;scheme=onetag;package=com.onetag.app;end');
  });

  it('lists the stores, the visitor’s platform first, and App Store only once it has an id', () => {
    const play = { label: 'Google Play', href: 'https://play.google.com/store/apps/details?id=com.onetag.app' };
    const appStore = { label: 'App Store', href: 'https://apps.apple.com/app/id1234567890' };
    expect(storeLinks(null, false)).toEqual([play]);
    expect(storeLinks('1234567890', false)).toEqual([appStore, play]);
    expect(storeLinks('1234567890', true)).toEqual([play, appStore]);
  });
});

// ─── The well-known files ───────────────────────────────────────────────

describe('the well-known files', () => {
  const committed = (file: string) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'public', '.well-known', file), 'utf8'));

  it('are the documents committed in public/.well-known', () => {
    expect(APPLE_APP_SITE_ASSOCIATION).toEqual(committed('apple-app-site-association'));
    expect(ASSET_LINKS).toEqual(committed('assetlinks.json'));
  });

  it.each(['apple-app-site-association', 'assetlinks.json'])(
    'serves %s as application/json, with no redirect',
    async (file) => {
      const { deps, source } = setup();
      const response = await handleRequest(request(`/.well-known/${file}`), deps);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(response.headers.get('location')).toBeNull();
      expect(JSON.parse(await response.text())).toEqual(committed(file));
      expect(source.resolveTag).not.toHaveBeenCalled();
    },
  );

  it('answers HEAD without a body', async () => {
    const response = await handleRequest(request('/.well-known/assetlinks.json', { method: 'HEAD' }), setup().deps);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it.each(['/.well-known/apple-app-site-association.json', '/.well-known/constructor', '/.well-known/'])(
    'serves nothing else under .well-known: %s',
    async (pathname) => {
      const response = await handleRequest(request(pathname), setup().deps);
      expect(response.status).toBe(404);
    },
  );
});

// ─── A live tag ─────────────────────────────────────────────────────────

describe('a live tag', () => {
  it("renders a landing page with the Destination's name, what it is, a way into the app and the store", async () => {
    const { deps } = setup();
    const response = await handleRequest(request(`/t/${CODE}`), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const page = await html(response);
    expect(page).toContain('<h1>Acme Woodworks</h1>');
    expect(page).toContain('<p class="label">Business Profile</p>');
    expect(page).toContain('<p class="byline">@acme</p>');
    expect(page).toContain('<a class="button primary" href="onetag://t/ABC23XYZ">Open in OneTag</a>');
    expect(page).toContain('href="https://play.google.com/store/apps/details?id=com.onetag.app"');
  });

  it('describes the Destination to link previews', async () => {
    const page = await html(await handleRequest(request(`/t/${CODE}`), setup().deps));
    expect(metaContent(page, 'og:title')).toBe('Acme Woodworks');
    expect(metaContent(page, 'og:description')).toBe('Business Profile @acme on OneTag');
    expect(metaContent(page, 'og:image')).toBe('https://cdn.example.test/avatars/acme.jpg');
    expect(metaContent(page, 'og:url')).toBe('https://onetag.app/t/ABC23XYZ');
    expect(metaContent(page, 'twitter:card')).toBe('summary');
    expect(metaContent(page, 'twitter:image')).toBe('https://cdn.example.test/avatars/acme.jpg');
    expect(page).toContain('<title>Acme Woodworks · OneTag</title>');
    expect(page).toContain('<link rel="canonical" href="https://onetag.app/t/ABC23XYZ">');
  });

  it('builds its own URL from TAG_BASE_URL, never from the host the request came through', async () => {
    const { deps } = setup();
    // Called at /functions/v1/tag-resolve/t/<code>, a function sees /tag-resolve/t/<code>.
    const response = await handleRequest(
      request(`/tag-resolve/t/${CODE}`, { host: 'https://abcdefgh.supabase.co' }),
      { ...deps, tagBaseUrl: 'https://onetag.co/' },
    );
    expect(metaContent(await html(response), 'og:url')).toBe('https://onetag.co/t/ABC23XYZ');
  });

  it('records the Scan anonymously, for the tag it resolved', async () => {
    const { deps, source, background } = setup();
    await handleRequest(request(`/t/${CODE}`), deps);
    await Promise.all(background);
    expect(source.recordScan).toHaveBeenCalledTimes(1);
    expect(source.recordScan).toHaveBeenCalledWith('tag-1');
  });

  it('opens the app on Android through an intent that falls back to its Play listing', async () => {
    const page = await html(await handleRequest(request(`/t/${CODE}`, { ua: ANDROID }), setup().deps));
    expect(page).toContain(
      'href="intent://t/ABC23XYZ#Intent;scheme=onetag;package=com.onetag.app;end">Open in OneTag</a>',
    );
  });

  it("shows a product's first photo and who lists it", async () => {
    const { deps, source } = setup({ resolveTag: jest.fn(async () => productTag) });
    const page = await html(await handleRequest(request(`/t/${CODE}`), deps));
    expect(source.readProduct).toHaveBeenCalledWith('pd-1');
    expect(page).toContain('<h1>Oak door</h1>');
    expect(page).toContain('<p class="label">Product</p>');
    expect(page).toContain('<p class="byline">by Acme Woodworks</p>');
    expect(page).toContain('<img class="cover" src="https://cdn.example.test/door-front.jpg" alt="">');
    expect(metaContent(page, 'og:image')).toBe('https://cdn.example.test/door-front.jpg');
    expect(metaContent(page, 'twitter:card')).toBe('summary_large_image');
  });

  it("shows a project's cover and who runs it", async () => {
    const { deps, source } = setup({ resolveTag: jest.fn(async () => projectTag) });
    const page = await html(await handleRequest(request(`/t/${CODE}`), deps));
    expect(source.readProject).toHaveBeenCalledWith('pj-1');
    expect(page).toContain('<h1>Kitchen remodel</h1>');
    expect(page).toContain('<p class="label">Project</p>');
    expect(page).toContain('<p class="byline">by Jane Doe</p>');
    expect(metaContent(page, 'og:image')).toBe('https://cdn.example.test/kitchen.jpg');
  });

  it('names a post by who posted it, reading nothing a stranger may not see', async () => {
    const { deps, source, background } = setup({ resolveTag: jest.fn(async () => postTag) });
    const response = await handleRequest(request(`/t/${CODE}`), deps);
    expect(response.status).toBe(200);
    const page = await html(response);
    expect(page).toContain('<h1>A post by @jane</h1>');
    expect(page).toContain('<p class="label">Post</p>');
    expect(page).toContain('href="onetag://t/ABC23XYZ">Open in OneTag</a>');
    expect(source.readProfile).not.toHaveBeenCalled();
    await Promise.all(background);
    expect(source.recordScan).toHaveBeenCalledWith('tag-1');
  });

  it('stands an initial in for a missing avatar, and a handle for a missing name', async () => {
    const { deps } = setup({
      readProfile: jest.fn(async () => ({ username: 'jane', full_name: null, avatar_url: null, profile_type: 'individual' as const })),
    });
    const page = await html(await handleRequest(request(`/t/${CODE}`), deps));
    expect(page).toContain('<h1>@jane</h1>');
    expect(page).toContain('<p class="label">Individual Profile</p>');
    expect(page).toContain('<div class="avatar" aria-hidden="true">J</div>');
    expect(page).not.toContain('class="byline"');
    expect(metaContent(page, 'og:image')).toBeNull();
  });

  it("reads a private project as gone, the way the app's project screen does, and still counts the Scan", async () => {
    const { deps, source, background } = setup({
      resolveTag: jest.fn(async () => projectTag),
      readProject: jest.fn(async () => null),
    });
    const response = await handleRequest(request(`/t/${CODE}`), deps);
    expect(response.status).toBe(410);
    expect(await html(response)).toContain(`<h1>${escapeHtml(FAILURE_COPY['destination-missing'].title)}</h1>`);
    await Promise.all(background);
    expect(source.recordScan).toHaveBeenCalledWith('tag-1');
  });

  it('offers an Unlisted project only through the app, naming nothing, and counts the Scan (ONE-137)', async () => {
    const readProject = jest.fn(async () => null);
    const { deps, source, background } = setup({
      resolveTag: jest.fn(async () => ({ ...projectTag, dest_project_unlisted: true })),
      readProject,
    });
    const response = await handleRequest(request(`/t/${CODE}`), deps);
    expect(response.status).toBe(200);
    const page = await html(response);
    expect(page).toContain('Open this tag in OneTag');
    expect(page).not.toContain(escapeHtml(FAILURE_COPY['destination-missing'].title));
    expect(readProject).not.toHaveBeenCalled();
    await Promise.all(background);
    expect(source.recordScan).toHaveBeenCalledWith('tag-1');
  });

  it("still offers the way into the app when the Destination's details can't be read", async () => {
    const failure = new Error('connection reset');
    const { deps, logged } = setup({ readProfile: jest.fn(async () => Promise.reject(failure)) });
    const response = await handleRequest(request(`/t/${CODE}`), deps);
    expect(response.status).toBe(200);
    const page = await html(response);
    expect(page).toContain('href="onetag://t/ABC23XYZ">Open in OneTag</a>');
    expect(logged).toContain(failure);
  });
});

// ─── The Scan never holds up the page ───────────────────────────────────

describe('recording the Scan', () => {
  const within = <T>(work: Promise<T>, ms: number) =>
    Promise.race([
      work,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no response within ${ms}ms`)), ms)),
    ]);

  it('never delays the page: an insert that never finishes still gets a prompt response', async () => {
    const { deps, background } = setup({ recordScan: jest.fn(() => new Promise<void>(() => undefined)) });
    const response = await within(handleRequest(request(`/t/${CODE}`), deps), 1000);
    expect(response.status).toBe(200);
    expect(await html(response)).toContain('<h1>Acme Woodworks</h1>');
    // The insert was handed to the runtime to finish after the response.
    expect(background).toHaveLength(1);
  });

  it('never breaks the page: a failed insert is logged, and the page is the same', async () => {
    const failure = new Error('insert failed');
    const { deps, background, logged } = setup({ recordScan: jest.fn(async () => Promise.reject(failure)) });
    const response = await handleRequest(request(`/t/${CODE}`), deps);
    expect(response.status).toBe(200);
    await Promise.all(background);
    expect(logged).toEqual([failure]);
  });

  it('survives a source that throws before returning a promise', async () => {
    const { deps, background, logged } = setup({
      recordScan: jest.fn(() => {
        throw new Error('sync');
      }),
    });
    const response = await handleRequest(request(`/t/${CODE}`), deps);
    expect(response.status).toBe(200);
    await Promise.all(background);
    expect(logged).toHaveLength(1);
  });

  it('survives a runtime without waitUntil', async () => {
    const { deps } = setup();
    const response = await handleRequest(request(`/t/${CODE}`), {
      ...deps,
      waitUntil: () => {
        throw new Error('no waitUntil');
      },
    });
    expect(response.status).toBe(200);
  });

  it.each([
    ['iMessage', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0'],
    ['Slack', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['WhatsApp', 'WhatsApp/2.23.20.0 A'],
    ['Discord', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
    ['Telegram', 'TelegramBot (like TwitterBot)'],
    ['LinkedIn', 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)'],
    ['Google', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ])('is not a Scan when %s unfurls the link, which still gets its preview', async (_app, ua) => {
    const { deps, source, background } = setup();
    const page = await html(await handleRequest(request(`/t/${CODE}`, { ua }), deps));
    expect(metaContent(page, 'og:title')).toBe('Acme Woodworks');
    await Promise.all(background);
    expect(source.recordScan).not.toHaveBeenCalled();
  });

  it('counts a phone whose name happens to contain "bot"', () => {
    const cubot = 'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
    expect(isPersonReading(request(`/t/${CODE}`, { ua: cubot }))).toBe(true);
  });

  it('is not a Scan when the browser only prefetches the page', async () => {
    const { deps, source } = setup();
    await handleRequest(request(`/t/${CODE}`, { headers: { 'sec-purpose': 'prefetch;prerender' } }), deps);
    expect(source.recordScan).not.toHaveBeenCalled();
  });

  it('is not a Scan for a HEAD request, which gets no body', async () => {
    const { deps, source } = setup();
    const response = await handleRequest(request(`/t/${CODE}`, { method: 'HEAD' }), deps);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(source.recordScan).not.toHaveBeenCalled();
  });
});

// ─── Failures ───────────────────────────────────────────────────────────

describe('a tag that does not open', () => {
  it.each<TagFailure>(['not-found', 'inactive', 'unlinked', 'failed', 'destination-missing'])(
    "says what the app's route says for %s",
    (failure) => {
      const app = APP_FAILURE_COPY[failure];
      expect(FAILURE_COPY[failure]).toEqual({ label: app.label, title: app.title, body: app.body });
    },
  );

  it('renders not-found for an unknown code, with a route onward and no Scan', async () => {
    const { deps, source } = setup({ resolveTag: jest.fn(async () => null) });
    const response = await handleRequest(request(`/t/${CODE}`), deps);
    expect(response.status).toBe(404);
    const page = await html(response);
    expect(page).toContain(`<p class="label">Unknown tag · ${CODE}</p>`);
    expect(page).toContain(`<h1>${escapeHtml(FAILURE_COPY['not-found'].title)}</h1>`);
    expect(page).toContain('<a class="button primary" href="onetag://t/ABC23XYZ">Open OneTag</a>');
    expect(page).toContain('href="https://play.google.com/store/apps/details?id=com.onetag.app"');
    expect(source.recordScan).not.toHaveBeenCalled();
  });

  it('renders inactive for a paused tag, distinct from not-found, with no Scan', async () => {
    const paused: ResolveTagRow = { ...profileTag, tag_id: null, active: false, dest_profile_id: null, dest_profile_username: null };
    const { deps, source } = setup({ resolveTag: jest.fn(async () => paused) });
    const response = await handleRequest(request(`/t/${CODE}`), deps);
    expect(response.status).toBe(410);
    const page = await html(response);
    expect(page).toContain(`<h1>${escapeHtml(FAILURE_COPY.inactive.title)}</h1>`);
    expect(page).not.toContain(escapeHtml(FAILURE_COPY['not-found'].title));
    expect(source.readProfile).not.toHaveBeenCalled();
    expect(source.recordScan).not.toHaveBeenCalled();
  });

  it("says a blank tag isn't set up yet, and records no Scan (ONE-139)", async () => {
    const blank: ResolveTagRow = {
      ...profileTag,
      tag_id: null,
      active: true,
      dest_profile_id: null,
      dest_profile_username: null,
      linked: false,
      owned_by_caller: false,
    };
    const { deps, source } = setup({ resolveTag: jest.fn(async () => blank) });
    const response = await handleRequest(request(`/t/${CODE}`), deps);
    expect(response.status).toBe(404);
    const page = await html(response);
    expect(page).toContain(`<p class="label">Not set up · ${CODE}</p>`);
    expect(page).toContain(`<h1>${escapeHtml(FAILURE_COPY.unlinked.title)}</h1>`);
    expect(page).not.toContain(escapeHtml(FAILURE_COPY.inactive.title));
    expect(page).toContain('<a class="button primary" href="onetag://t/ABC23XYZ">Open OneTag</a>');
    expect(source.recordScan).not.toHaveBeenCalled();
  });

  it.each(['ABC23', 'ABC23XYZA', 'ABC2OXYZ', 'ABC23X%20', '%3Cscript%3Ealert(1)%3C%2Fscript%3E', '<b>x</b>', '...'])(
    'rejects %p before any query runs',
    async (segment) => {
      const { deps, source } = setup();
      const response = await handleRequest(request(`/t/${segment}`), deps);
      expect(response.status).toBe(404);
      const page = await html(response);
      expect(page).toContain(`<p class="label">${FAILURE_COPY['not-found'].label}</p>`);
      // Nothing from the path is echoed back, and the app opens at its start.
      expect(page).not.toContain('<b>');
      expect(page).toContain('href="onetag://">Open OneTag</a>');
      expect(metaContent(page, 'og:url')).toBeNull();
      for (const read of Object.values(source)) expect(read).not.toHaveBeenCalled();
    },
  );

  it('renders failed, with a way to try again, when the database cannot say', async () => {
    const failure = new Error('timeout');
    const { deps, source, logged } = setup({ resolveTag: jest.fn(async () => Promise.reject(failure)) });
    const response = await handleRequest(request(`/t/${CODE}`), deps);
    expect(response.status).toBe(503);
    const page = await html(response);
    expect(page).toContain(`<h1>${escapeHtml(FAILURE_COPY.failed.title)}</h1>`);
    expect(page).toContain('<a class="button primary" href="https://onetag.app/t/ABC23XYZ">Try again</a>');
    expect(page).toContain('<a class="button" href="onetag://t/ABC23XYZ">Open OneTag</a>');
    expect(logged).toEqual([failure]);
    expect(source.recordScan).not.toHaveBeenCalled();
  });

  it('renders destination-missing for a live tag with nowhere to go', async () => {
    const nowhere: ResolveTagRow = { ...profileTag, dest_profile_id: null, dest_profile_username: null };
    const { deps } = setup({ resolveTag: jest.fn(async () => nowhere) });
    const response = await handleRequest(request(`/t/${CODE}`), deps);
    expect(response.status).toBe(410);
    expect(await html(response)).toContain(`<h1>${escapeHtml(FAILURE_COPY['destination-missing'].title)}</h1>`);
  });
});

// ─── The page itself ────────────────────────────────────────────────────

describe('the page', () => {
  const render = async (overrides: Partial<TagSource> = {}, ua = IPHONE) =>
    html(await handleRequest(request(`/t/${CODE}`, { ua }), setup(overrides).deps));

  it('escapes everything that came from the database', async () => {
    const page = await render({
      readProfile: jest.fn(async () => ({
        ...acme,
        full_name: `<img src=x onerror=alert(1)> "Acme" & 'Sons'`,
      })),
    });
    expect(page).not.toContain('<img src=x');
    expect(page).toContain('<h1>&lt;img src=x onerror=alert(1)&gt; &quot;Acme&quot; &amp; &#39;Sons&#39;</h1>');
    expect(metaContent(page, 'og:title')).toBe('&lt;img src=x onerror=alert(1)&gt; &quot;Acme&quot; &amp; &#39;Sons&#39;');
  });

  it('loads an image from http or https only', async () => {
    const page = await render({ readProfile: jest.fn(async () => ({ ...acme, avatar_url: 'javascript:alert(1)' })) });
    expect(page).not.toContain('javascript:');
    expect(metaContent(page, 'og:image')).toBeNull();
    expect(safeImageUrl('https://cdn.example.test/a.jpg')).toBe('https://cdn.example.test/a.jpg');
    expect(safeImageUrl('http://127.0.0.1:54321/storage/v1/object/public/avatars/a.jpg')).not.toBeNull();
    expect(safeImageUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(safeImageUrl('not a url')).toBeNull();
    expect(safeImageUrl(null)).toBeNull();
  });

  it('is one self-contained document: inline CSS, no script, Google Fonts the only stylesheet', async () => {
    const page = await render();
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).not.toMatch(/<script/i);
    expect(page.match(/<style>/g)).toHaveLength(1);
    const stylesheets = Array.from(page.matchAll(/<link rel="stylesheet" href="([^"]+)">/g), (m) => m[1]);
    expect(stylesheets).toHaveLength(1);
    expect(stylesheets[0]).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=DM\+Mono/);
  });

  it('is laid out for a phone', async () => {
    const page = await render();
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
    expect(page).toContain('<html lang="en">');
  });

  it('draws in the token colours, copied from theme/tokens.ts', async () => {
    const hexes = (await render()).match(/#[0-9a-f]{6}\b/gi) ?? [];
    expect(hexes.length).toBeGreaterThan(0);
    const tokens = Object.values(color).map((value) => value.toLowerCase());
    for (const hex of hexes) expect(tokens).toContain(hex.toLowerCase());
  });

  it('is kept out of search results, and allows no script', async () => {
    const { deps } = setup();
    const response = await handleRequest(request(`/t/${CODE}`), deps);
    expect(metaContent(await response.text(), 'robots')).toBe('noindex');
    const policy = response.headers.get('content-security-policy') ?? '';
    expect(policy).toContain("default-src 'none'");
    expect(policy).not.toContain('script-src');
  });
});

describe('anything else', () => {
  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS'])('refuses %s', async (method) => {
    const response = await handleRequest(request(`/t/${CODE}`, { method }), setup().deps);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it.each(['/', '/favicon.ico', '/login', '/tag-resolve'])('is not found: %s', async (pathname) => {
    const { deps, source } = setup();
    const response = await handleRequest(request(pathname), deps);
    expect(response.status).toBe(404);
    expect(source.resolveTag).not.toHaveBeenCalled();
  });
});
