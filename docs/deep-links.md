# Deep links and universal links

Every Tag URL is `https://<tag host>/t/<short code>`, built by `lib/tagLinks.ts` from
`EXPO_PUBLIC_TAG_BASE_URL` (default `https://onetag.app`). The URL is printed onto stickers,
so it has to open the app for people who have it and still work for people who don't.

A tag link opens in one of three ways:

1. **Universal link (iOS) or App Link (Android).** The app is installed and the OS has
   verified the tag host, so the OS opens the app straight at `/t/<code>`. No browser is
   involved. This needs the app to declare the host (`app.config.ts`) and the tag host to
   serve the two files in `public/.well-known/`.
2. **The custom scheme, `onetag://t/<code>`.** It works whenever the app is installed,
   verified or not. It is the fallback, and it is what the in-app scanner reads.
3. **No app.** The browser loads the tag host's landing page (see [The tag host](#the-tag-host)).

Only `/t/*` opens the app from the tag host. Everything else the app shares uses the custom
scheme: `onetag://product/<id>`, `onetag://project/<id>`, `onetag://reset-password`.

## Configuration

**`app.config.ts`** takes `app.json` and adds the universal-link setup for the tag host:
`applinks:<host>` in the iOS associated domains, and an auto-verified Android intent
filter for `https://<host>/t/`. The host comes from `EXPO_PUBLIC_TAG_BASE_URL`, the same
variable the app builds tag URLs from. A build therefore can't print one host into its QR
codes and declare another. Set the variable in the EAS build profile (`env` in `eas.json`,
or an EAS environment variable) so the bundle and the native config see the same value.
`__tests__/appConfig.test.ts` pins that the derived host matches `lib/tagLinks.ts`.

The Android filter lists `https` and nothing else. A custom scheme in the same filter stops
it from verifying on Android 11 and earlier. Expo registers `onetag://` in its own filter,
from `scheme` in `app.json`.

**`public/.well-known/`** holds the two files the OS fetches from the tag host:

| File | Content type | Holds |
| -- | -- | -- |
| `apple-app-site-association` (no extension) | `application/json` | `<Team ID>.com.onetag.app`, for `/t/*` |
| `assetlinks.json` | `application/json` | `com.onetag.app` and its signing-certificate SHA-256 fingerprints |

Until they are filled in (ONE-97), they carry placeholders:

- `APPLE_TEAM_ID` is the 10-character Team ID from developer.apple.com, under Membership
  details. `eas credentials -p ios` shows it too.
- `PLAY_APP_SIGNING_KEY_SHA256` is the **app signing key** from Play Console: Test and
  release, then App integrity, then App signing. Play re-signs every app it installs with
  this key, so without it no Play-installed copy verifies.
- `EAS_UPLOAD_KEY_SHA256` is the keystore EAS signs with (`eas credentials -p android`,
  production profile). It signs the builds EAS installs directly, such as development and
  preview builds. If Play signs with the same key, list it once.

A debug keystore's fingerprint verifies nothing in production. Remove any slot you don't
fill, because a placeholder isn't a fingerprint. `__tests__/wellKnown.test.ts` accepts a
placeholder or the real shape, nothing else.

The tag host serves these documents from `supabase/functions/tag-resolve/handler.ts`
(`APPLE_APP_SITE_ASSOCIATION` and `ASSET_LINKS`), because a function can't read `public/`.
When you fill in a value, change it in both places; `__tests__/supabase/tagResolve.test.ts`
fails until they agree. The web page's App Store button waits on `APP_STORE_ID` in the same
file, the listing's numeric id from App Store Connect. Until it's set, the page offers
Google Play alone.

## The tag host

The tag host answers two kinds of request, and both come from one Supabase Edge Function,
`supabase/functions/tag-resolve`:

| Path | Response |
| -- | -- |
| `/t/<code>` | The landing page for someone without the app: what the tag points to, **Open in OneTag**, and the store listings. Records the Scan. |
| `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` | The two files above, as `application/json`. |

Everything else on the host is free for other uses, such as a marketing site.

The page is one HTML document: inline CSS, no script, and no client-side fetching. It
reads with the anon key and no session, so RLS decides what a stranger sees: the tag
through `resolve_tag`, the Destination through its public read, and the Scan through
the anonymous insert. A private project reads as gone, as it does in the app. Link
previews (iMessage, Slack, WhatsApp and the rest) get the Open Graph tags but record no
Scan, and neither do HEAD requests or browser prefetches. The Scan is written after the
response, so a slow insert never holds up the page.

**Open in OneTag** is a link, never an automatic redirect. With the app installed,
universal links open it before the browser loads anything. Without it, an automatic
`onetag://` redirect would show iOS Safari's "address is invalid" alert. So the button
is `onetag://t/<code>` on iOS, and on Android an `intent://` link that falls back to the
Play listing.

### Routing the host to the function

The printed URL is `https://<tag host>/t/<code>`, but a function answers at
`https://<project ref>.supabase.co/functions/v1/tag-resolve/...`. Supabase also serves
HTML from a function only on a custom domain: on `*.supabase.co`, a `text/html` response
to a GET is rewritten to `text/plain`. So the host is fronted by a Cloudflare Worker, on
the routes `<tag host>/t/*` and `<tag host>/.well-known/*`:

```js
// Cloudflare Worker on the tag host. Routes: <tag host>/t/* and <tag host>/.well-known/*.
const FUNCTION_URL = 'https://<project ref>.supabase.co/functions/v1/tag-resolve';

export default {
  async fetch(request) {
    const { pathname, search } = new URL(request.url);

    // The function picks the Android link and skips link previews by these.
    const headers = new Headers();
    for (const name of ['user-agent', 'accept', 'accept-language', 'sec-purpose', 'purpose']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const upstream = await fetch(`${FUNCTION_URL}${pathname}${search}`, {
      method: request.method,
      headers,
      redirect: 'manual',
    });

    // Supabase rewrites the tag page to text/plain on *.supabase.co. It is HTML.
    const response = new Headers(upstream.headers);
    if (!pathname.startsWith('/.well-known/')) response.set('content-type', 'text/html; charset=utf-8');
    return new Response(upstream.body, { status: upstream.status, headers: response });
  },
};
```

Keep it a pass-through:

- **No redirects** on either route: no trailing-slash rules, no `www` rewrite. Apple and
  Google ignore a redirected well-known file.
- **No caching of `/t/*`.** Every view records a Scan, and a tag can be paused at any time.
  The function sends `cache-control: no-store`.
- The function builds the page's own URL (canonical, `og:url`) from its `TAG_BASE_URL`
  secret, never from the host the request came through.

The alternative is Supabase's Custom Domain add-on, which is paid and lets a function serve
HTML, plus a rewrite on the tag host to `/functions/v1/tag-resolve/*`. The paths still
need rewriting either way, since the function doesn't sit at the host's root.

### Deploying

Merging a change under `supabase/functions` deploys every function, through the
`deploy-functions` workflow behind the production review. Its secret is set once, by hand:

```bash
supabase secrets set TAG_BASE_URL=https://onetag.app
```

To deploy it before anything has merged, or again without a change:

```bash
supabase functions deploy tag-resolve
```

`TAG_BASE_URL` has to equal the app's `EXPO_PUBLIC_TAG_BASE_URL`, and it defaults to the
same `https://onetag.app`. `verify_jwt = false` in `supabase/config.toml` lets browsers in
without a JWT, and the deploy reads it from there. Then check the host itself:

```bash
curl -sSI https://onetag.app/t/<code>
```

Expect `200` and `content-type: text/html; charset=utf-8`. Then check what a link preview
sees:

```bash
curl -sS -A "facebookexternalhit/1.1" https://onetag.app/t/<code>
```

Look for `og:title` and `og:image` in the output.

To run it locally against `npm run db:start`:

```bash
npx supabase functions serve tag-resolve
```

Then open `http://127.0.0.1:54321/functions/v1/tag-resolve/t/<code>`. The local gateway
serves HTML as-is.

## Testing needs a real build

Neither platform verifies universal links in Expo Go. Expo Go is a different app, and the
two files name `com.onetag.app`. Test with an EAS build:

- **Android:** a `development` or `preview` build.
- **iOS:** a device build, such as `preview`. The `development` profile builds for the
  simulator.

iOS doesn't fetch the association file from the tag host. It fetches it through Apple's CDN
when the app is installed, and the CDN caches it. A corrected file can take a day or more
to reach devices, and reinstalling the app makes the device ask again. For quicker loops in
development, Apple's `applinks:<host>?mode=developer` together with Developer Mode on the
device skips the CDN. It isn't wired into `app.config.ts`.

## Verifying

### The association file (iOS)

```bash
curl -sSI https://onetag.app/.well-known/apple-app-site-association
```

Expect a `200` straight away: no `3xx`, no `Location` header, and
`content-type: application/json`. Apple ignores a redirected file, a file with an
extension, and a file served as anything else, and it says nothing when it does. Then:

```bash
curl -sS https://app-site-association.cdn-apple.com/a/v1/onetag.app
```

That is the copy devices actually get. On a device running iOS 16 or later, Settings,
then Developer, then Universal Links, then Diagnostics, takes a tag URL and says whether
it would open the app.

### The asset links (Android)

```bash
curl -sSI https://onetag.app/.well-known/assetlinks.json
```

Expect the same: `200`, `application/json`, no redirect. Google's own reading of it:

```bash
curl -sS "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://onetag.app&relation=delegate_permission/common.handle_all_urls"
```

On a device with the build installed:

```bash
adb shell pm get-app-links com.onetag.app
```

Expect the tag host listed as `verified`. To make Android 12 or later verify again after
fixing the file:

```bash
adb shell pm set-app-links --package com.onetag.app 0 all
```

```bash
adb shell pm verify-app-links --re-verify com.onetag.app
```

Then run `get-app-links` again after a few seconds. Android 11 and earlier verify only at
install time, so reinstall the app instead.

### A tag link from outside the app

- **iOS:** paste `https://<tag host>/t/<code>` into Notes or Messages and tap it. Typing a
  URL into Safari's address bar never opens an app; that's by design.
- **Android:**

  ```bash
  adb shell am start -W -a android.intent.action.VIEW -d "https://onetag.app/t/ABC23XYZ"
  ```

  Once the host is verified, the app opens without a chooser.
- **Cold start:** quit the app first. The link lands on the Destination alone on the
  stack, and Back goes home: the tabs signed in, sign-up signed out (`lib/useBackOrHome.ts`,
  ONE-90).

### The custom scheme still works

```bash
adb shell am start -W -a android.intent.action.VIEW -d "onetag://t/ABC23XYZ" com.onetag.app
```

```bash
xcrun simctl openurl booted "onetag://t/ABC23XYZ"
```
