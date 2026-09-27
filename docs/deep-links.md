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
3. **No app.** The browser loads the tag host's landing page.

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
