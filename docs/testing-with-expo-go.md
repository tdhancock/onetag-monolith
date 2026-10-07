# Testing with Expo Go

How testers try OneTag on their own phones before it's in the App Store, with no Apple Developer
account (ONE-117). We publish the app with EAS Update, and they open it in Expo Go.

## What testers get, and what they don't

They get the whole app, running inside Expo Go and talking to the same Supabase project as your
local `.env`. They don't get:

- **Push notifications.** Expo Go dropped remote push in SDK 53. The Notifications screen still
  fills in.
- **Tag links from outside the app.** `https://<tag host>/t/…` opens OneTag's own build, never
  Expo Go. Scanning a tag with the in-app camera works.
- **Its own icon.** They open Expo Go, then OneTag inside it.
- **Old SDKs.** Expo Go runs only the SDK it was built for (57). When Expo Go moves to a new SDK,
  testers can't open OneTag until we upgrade and publish again.

For a real standalone build with push and tag links, use TestFlight. It needs the Apple
Developer Program.

## Adding a tester

Expo Go only opens a published project for people in the Expo organization that owns it.

1. The tester installs **Expo Go** (App Store or Play Store) and creates a free Expo account.
2. On expo.dev, open the organization, go to **Members**, and invite them by email or username
   as a **Viewer**. A Viewer can open the project in Expo Go and change nothing.
3. They accept the invite, sign in to Expo Go with that account, and open **OneTag** from the
   organization's projects on Expo Go's home screen.

## Publishing what they see

```bash
pnpm publish:preview --message "What changed"
```

This bundles the app on your machine and publishes it to the `preview` branch. Testers get it the
next time they open OneTag in Expo Go. If they already had it open, they close and reopen it.
Pick a message they'd understand: it shows beside each update on expo.dev.

**The app's settings come from EAS, not your `.env`.** Publishing with `--environment preview`
uses only the variables stored on EAS for that environment. It ignores `.env`, so an update
bundled without them has no Supabase URL, and it fails at launch. The three the app reads:

| Variable | Visibility |
| -- | -- |
| `EXPO_PUBLIC_SUPABASE_URL` | plain text |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | sensitive |
| `EXPO_PUBLIC_TAG_BASE_URL` | plain text |

List them with `npx eas-cli@latest env:list --environment preview`, and set or change one with
`npx eas-cli@latest env:set --environment preview --name <NAME> --value <value> --visibility
<plaintext|sensitive>`. A variable the app starts reading goes on EAS before it's published.

## Why the runtime is `sdkVersion`

An update only opens in a runtime it was published for. `runtimeVersion: { "policy":
"sdkVersion" }` in `app.json` publishes as `exposdk:57.0.0`, which is what Expo Go runs. An
update published for an app-version runtime can't be opened in Expo Go at all. When OneTag moves
to development builds or TestFlight, switch the policy to `appVersion` or `fingerprint`. Expo Go
then stops opening new updates, which is the point: they're for the builds.

## What to test in this build

Tell testers what changed, so they look there first. For the build from the first round of
feedback (PR #33):

- **Notifications** open where they're about: a follow opens the profile, a comment or reply
  opens the comments at that comment, a liked OneSnap opens it. Back returns to Notifications.
- **Messages** show each conversation's latest message and when it was sent. A conversation is
  its own screen: Back and the swipe return to the inbox.
- **Replies** to comments, threaded under them. Deleting a comment with replies asks first.
- **Tags** on a photo post, including tags that point to another post.
- **The keyboard** never covers what you're typing into: sign-up, Edit profile, comments,
  messages, products and projects.
- **Your profile** has a proper Edit profile button under the bio.
- **OneSnaps**: tap right for the next one, left for the one before.
- **Home** offers "New posts" when there are some, rather than moving the feed under you.
- **Coming back to the app** after a while refreshes what's on screen; offline, likes and
  follows wait and go through when the connection returns.
- **Handles**: sign-up, adding a profile and Edit profile all say "Taken" before you save.

Push notifications still can't be tested in Expo Go (above); the Notifications screen can.

## Your own phone

Nothing changes: `npx expo start` and scan the QR code in Expo Go, signed in to the same Expo
account as the CLI.
