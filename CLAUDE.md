# OneTag — working in this repo

How to work in the code. Product vocabulary and locked architecture decisions live in
[OneTag — Working Agreement](https://linear.app/onetag/document/onetag-working-agreement-read-first-a596e9467267),
the source of truth when the two disagree. Work is tracked in the Linear team **Onetag** (`ONE`).

## Stack

Expo SDK 57 · React Native 0.86 · expo-router (file-based routing) · NativeWind v4 · Supabase (Auth, Postgres, Storage, Realtime) · TypeScript

The React Native app is the product. Web is a thin surface so a scanned Physical Tag resolves
for someone without the app — never build full screen parity for web.

## Layout

```
app/                       expo-router routes — every screen, nothing else
  (auth)/                  login, signup, forgot-password
  (tabs)/                  tab bar screens
  <route>.tsx              stack screens: compose, messages, settings, …
components/native/         shared components
components/native/ui/      shared visual primitives — token-only, no raw hex
components/native/form.tsx TanStack Form, with the app's fields bound in (useAppForm, withForm)
features/<domain>/         the data layer — every server read and write lives here
lib/                       queryClient, QueryProvider, queryKeys, realtimeBridge, pure utilities
lib/screens/               pure screen logic, extracted so it can be tested
theme/tokens.ts            design tokens — the single source of truth for colour and type
store/AppContext.native    global UI state — no server data
services/                  supabase client and the shared ground features reach: postRows,
                           profileBootstrap, media/story upload, realtime
supabase/migrations/       schema
supabase/seeds/dev.sql     made-up people and content for the local stack and the hosted dev project
supabase/functions/        edge functions: delete-user-account, tag-resolve (the tag host's web page),
                           and send-push (the database calls it to send push notifications)
__tests__/                 Jest
  api/                     the API checks, against a running local stack (npm run check:api)
types.ts                   shared domain types (repo root)
app.config.ts              app.json plus universal links for the tag host (repo root)
public/.well-known/        the files the tag host serves so the OS opens the app for /t/*
docs/tags.md               the five Destination kinds, who may point a tag at what, and resolution
docs/deep-links.md         how tag links reach the app, and how to verify universal links
docs/push-notifications.md how a notification becomes a push, where each one opens, and turning it on
docs/testing-with-expo-go.md how testers open OneTag in Expo Go, and how to publish for them
docs/seed-data.md          what the seed holds, loading it, signing in as it, and removing it
scripts/                   CI gates
eslint.config.js           lint: the hooks rules, and the feature-folder rules enforced
```

**Every file under `app/` is a route.** expo-router registers `.ts` modules too, so a
non-route helper there becomes a navigable blank screen and warns about its missing default
export on every boot. Screen logic extracted for testing goes in `lib/screens/`; helpers that
belong to a domain go with that domain (see `services/mediaPicker.ts`). Nothing else goes
under `app/` (ONE-62).

`store/AppContext.native.tsx` and `services/supabase.native.ts` keep a `.native` suffix left
over from a web fork deleted in ONE-5. Neither has a non-native twin — import the `.native` one.

## Commands

```
npx expo start          # or npm start / npm run ios / npm run android
npm test                # jest
npm run test:watch
npx tsc --noEmit        # or npm run typecheck
npm run lint            # eslint, no warnings allowed
npm run verify          # typecheck + lint + test + raw-hex gate — what CI runs
npm run db:start        # local Supabase; also db:stop, db:status, db:reset, db:diff
npm run db:test         # the pgTAP suite in supabase/tests, against the local stack
npm run check:api       # the API checks in __tests__/api, against the local stack
npm run db:seed         # the seed into the local stack; db:seed:hosted for the dev project (docs/seed-data.md)
npm run publish:preview # publish for testers in Expo Go (docs/testing-with-expo-go.md)
```

Tests run on **ts-jest** in a `node` environment with no React Native preset (`jest.config.js`);
`jest-expo` is a devDependency but is *not* wired up. A suite touching a native component must
`jest.mock` each native module in its import graph (`react-native`, `react-native-svg`,
`expo-image`, …) — existing suites show the pattern.

Mocked suites can't see what happens between the app and the database: a select string
PostgREST refuses, an id list too long for a URL, a read past the 1,000-row cap, a permission
reopened. **The API checks do** (ONE-114): they drive the app's own data layer against the
local stack as throwaway accounts, and CI runs them with pgTAP whenever `supabase/`,
`features/` or `services/` change. They're kept out of `npm test`. A new exported select
string goes in `__tests__/api/select_strings.test.ts`; a change to a read's reach or a
permission gets a check beside the others. The harness refuses any host but the local one.

**Never run `supabase db push`.** Migrations apply against a local stack (`npm run db:start`,
`npm run db:reset`) and reach production only via the `deploy-migrations` workflow on merge,
behind a required review. Edge functions go the same way, through `deploy-functions`, which
deploys every function whenever one changes on `main`; their secrets are set once by hand.

**A function only signed-in callers run revokes `FROM PUBLIC, anon`**, then grants
`authenticated`. Supabase's default privileges grant every new `public` function to `anon`
directly, so revoking PUBLIC alone leaves anon able to call it (ONE-85).
`supabase/tests/function_privileges.test.sql` pins who may call what — add a new function to it.

## State boundary

Server data belongs in **TanStack Query**, in `features/`. `AppContext` holds only UI state no
server owns — `theme`, `toasts`, `tooltip`, `topNotification`, `isViewingStory`, and the
per-device `viewedStoryTimestamps`. Even the auth session is a query (`features/auth`,
`useAuthUserId()`), and so is the admin flag (`features/admin`, `useIsAdmin()`).
The signed-in identity is `useCurrentProfile()` from `features/profiles` — the acting
`profileId`, the account's `authUserId`, and a display `profile`. `useApp()` keeps only the
block pass-throughs, which hold no state. Putting server data back into `AppContext` is
the mistake this rule exists to prevent; if a ticket asks you to, the ticket is wrong — say so
on the ticket rather than working around it.

## Feature folders (M2 onward)

Every data domain takes the same shape:

```
features/<domain>/
  api.ts        pure Supabase functions. No React, no hooks, no imports from features/
  keys.ts       query key factory — the only place key strings are built
  queries.ts    useXQuery hooks wrapping api.ts
  mutations.ts  useXMutation hooks, optimistic where the UI needs instant feedback
  types.ts      domain types
  index.ts      public surface — other features import only from here
```

**`features/hashtags/` is the canonical example** — the smallest domain in the app, one read
and no mutations, so the structure is visible without domain logic on top of it. Copy it.
A domain with no mutations has no `mutations.ts`; don't add an empty file to match the list.

Three rules, stated in full in [`features/README.md`](features/README.md):

1. `api.ts` imports nothing from React and nothing from another feature. It may import the
   Supabase client from `services/` and its own `./types`.
2. Screens and other features import **only** from `features/<domain>` — the `index.ts`
   barrel — never from a file inside it.
3. Query keys are built **only** in `keys.ts`, via `createQueryKeys` from `lib/queryKeys.ts`.
   A raw array key literal anywhere else is a bug.

Keys are hierarchical because TanStack matches by key prefix: `postKeys.all` is `['posts']`,
`postKeys.list({userId})` is `['posts','list',{userId}]`, so invalidating `all` reaches every
key beneath it while `lists()` leaves cached details alone.

Like, Save, Follow and Repost are one operation — an optimistic boolean toggle over a join
table with a count — so they share **one** generic helper. Four hand-written variants is the
thing this pattern exists to prevent.

**Screens read through hooks.** A screen or component never calls a domain's `get…`,
`fetch…` or `search…` itself; it uses the query hook, adding one if there isn't one. A read in
an effect is uncached and never refetches. ESLint enforces this and rules 2 and 3.

TanStack Query knows when the app returns to the front and when it's offline
(`lib/QueryProvider.tsx`): stale queries refetch on return, and offline, queries and mutations
wait. The cache shows in Expo's dev tools (shift+m in `npx expo start`, React Query).

M2 is finished: the old shared service module is gone and every domain lives in a feature
folder. When a feature's `api.ts` needs something another feature has, move it to `services/`
— see `services/postRows.ts` — rather than importing across features.

## Styling

`theme/tokens.ts` is the single source of truth, and NativeWind classes and inline styles both
resolve to it. The whole app is on the tokens (M1c closed in ONE-77), and it is gated: **no raw
colours and no old-skin classes anywhere.** `npm run verify` and CI run
`scripts/check-no-raw-hex.sh` over `theme/`, `lib/`, `features/`, `app/` and `components/`,
failing on a hex literal, a hand-written `rgb()`/`rgba()`/`hsl()`, a quoted named colour
(`"white"`, `'black'`; `'transparent'` is fine), or the old dark skin's NativeWind classes
(`bg-black`, `bg-gray-*`, `text-white`, `text-gray-*`, `text-blue-*`, `border-gray-*`, …).
`__tests__/scripts/noRawHexGate.test.ts` pins that directory list, so narrowing the gate means
changing the test too. Add `// allow-hex` only when a literal
colour is genuinely required, and say why on the line. Full-bleed media stays black through the
`color.text` token, with `withAlpha` for scrims — never a literal.

Before re-skinning or building a screen, read the
[M1c screen style guide](https://linear.app/onetag/document/m1c-screen-style-guide-read-before-any-re-skin-ticket-8bb0f53b7796),
and reach for `components/native/ui` (Button, IconButton, TextField, ListRow, SettingsRow, Sheet,
EmptyState, Skeleton, …) rather than hand-rolling one inside a screen.

## Screens

- **A modal never pushes a screen onward.** On iOS whatever a modal opens becomes another
  modal, with no Back. A screen that leads on to others (Notifications, Messages) is a pushed
  screen. Modals are declared in `app/_layout.tsx`, never from inside the screen.
- **Text input sits in a `KeyboardAvoider`, scrolled by a `FormScrollView`** (both in
  `components/native`), never React Native's `KeyboardAvoidingView`: it measures wrong
  inside an iOS page sheet. A list with its own input uses `automaticallyAdjustKeyboardInsets`.
- **Forms run on TanStack Form** through `useAppForm` / `withForm` from
  `components/native/form.tsx`. The rules stay a pure function per form in `lib/screens`,
  returning an error per field, handed to the form with `draftValidator`
  (`lib/formErrors.ts`). A username field uses `useUsernameCheck`.
- **A gesture handler reads its callbacks through a ref.** A `PanResponder` is built once, so
  callbacks it closes over go stale; the OneSnap viewer closed on tap because of it.
  `react-hooks/exhaustive-deps` is an error; a dependency left out on purpose gets a disable
  comment saying why.

## Vocabulary

Use these exactly — as table names, variable names, and user-facing labels.

| Term | Meaning |
| -- | -- |
| **Tag** | A portal linking to exactly one Destination. Never the destination itself. |
| **Physical Tag** | A QR code in the real world. Always-on; anyone can scan it without the owner present. May be printed **blank** and Linked to its Destination later, once (ONE-135). |
| **Digital Tag** | A Tag shared from inside the app as a short link. The owner shares it deliberately. |
| **Embedded Tag** | A Tag inside a post, pinned to a point on its image. Created during post creation. Tapped, never scanned. In the UI it is just a tag. |
| **Destination** | What a Tag points to. Exactly five kinds: Business Profile, Individual Profile, Product, Project, Post. (Post was added 2026-09-28, reversing ONE-83.) |
| **Tag Resolution** | Reading a Tag, identifying its Destination, routing there, recording the Scan. |
| **Scan** | Reading a Physical Tag with the camera. Applies to Physical Tags only. |
| **Scan History** | A user's private log of Tags they scanned. Private by default; opt-in to public. |
| **Profile** | A presence on the platform. Either a Business Profile or an Individual Profile. |
| **Product** | A taggable catalog item listed by a Business Profile. A Tag Destination, not a thing you can buy — payments are permanently out of scope (see below). |
| **Project** | A build, install or completed work, or a thing kept on record. Can link many Contributors and Products. One level of projects can sit inside another: the house, and the furnace in it (ONE-134). |
| **Unlisted** | A project visibility between Public and Private: listed nowhere, readable by whoever opened one of its tags (ONE-137). |
| **Contributor** | A Profile Linked to a Project as participant or supplier. **Never "vendor".** |
| **Linked** | The verb for connections between entities. Not "attached", "connected", or "associated". |
| **Save** | Bookmarking a Product, Project, or Profile. Not "favorite", "bookmark", or "like". |
| **OneSnap** | Ephemeral 24-hour content. Renders as a **square card, never a circle**. |
| **Waterfall Discovery** | Navigating down through connected content. Every page must offer somewhere to go next. |

Avoid: *vendor* → Contributor · *favorite* / *bookmark* → Save · *story* → OneSnap in new copy · *tag dot* → tag (an Embedded Tag is just a tag).

## Two locked decisions that change how you write code

Settled — don't relitigate in a ticket; raise a comment instead. Reasoning in the Working
Agreement, along with the rest.

- **Auth user id ≠ profile id** (after M3). An account may hold both a Business and an
  Individual Profile on the single `profiles` table. Content is attributed to the **active
  profile**, never the auth user — but **storage upload paths stay keyed by the auth user id**,
  because storage RLS gates on `auth.uid()` appearing in the folder name.
  The types enforce it: `ProfileId` and `AuthUserId` are branded (repo-root `types.ts`). Hooks
  that act as someone take a `ProfileId` from `useCurrentProfile()`; account-scoped ones — push
  tokens, blocks, admin, storage paths — take an `AuthUserId`. RLS ownership goes through
  `public.owns_profile()`; `npm run db:test` runs the pgTAP RLS suite against the local stack.
- **Tag URLs are built in exactly one place**, `lib/tagLinks.ts`, from
  `EXPO_PUBLIC_TAG_BASE_URL`. Never hardcode or assemble one elsewhere — these get printed onto
  physical objects and cannot be changed afterwards. `app.config.ts` derives the universal-link
  host from the same variable, and `supabase/functions/tag-resolve` (Deno, which can't import
  it) mirrors its rules; tests keep each copy in step.

Migration is strangler-style: **the app must run correctly after every ticket.**

## Permanently out of scope

Not part of this plan, however much the reference design documents describe them — those
documents are disposable inspiration, not a mandate: Stripe and all payment processing ·
checkout, carts, orders · affiliate links, commission calculation, attribution windows,
payouts · leads inbox and quote requests · team permission seats and role-based business
access · brand partnership marketplace, campaigns, gifted products · multi-seller product
pages · NFC (QR only; `expo-camera` is already installed)

If a ticket seems to lead toward any of these, stop at the boundary and note it on the ticket.

## Definition of done

1. `npx tsc --noEmit` passes
2. `npm test` passes
3. Every acceptance criterion on the ticket demonstrably met
4. No new raw hex, no new server state in `AppContext`
5. App boots: `npx expo start`
