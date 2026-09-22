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
app/                       expo-router routes — every screen
  (auth)/                  login, signup, forgot-password
  (tabs)/                  tab bar screens (+ their *.utils.ts, which are live)
  <route>.tsx              stack screens: compose, messages, settings, …
components/native/         shared components
store/AppContext.native    global UI state
services/                  supabase client, apiService, realtime, notifications, storage
supabase/migrations/       schema
__tests__/                 Jest
types.ts                   shared domain types (repo root)
scripts/                   CI gates
```

`store/AppContext.native.tsx` and `services/supabase.native.ts` keep a `.native` suffix left
over from a web fork deleted in ONE-5. Neither has a non-native twin — import the `.native` one.

**Not here yet:** `theme/tokens.ts` (M1a), `features/<domain>/` (M2), `lib/tagLinks.ts` (M4).
Don't import them before their ticket lands.

## Commands

```
npx expo start          # or npm start / npm run ios / npm run android
npm test                # jest
npm run test:watch
npx tsc --noEmit        # or npm run typecheck
npm run verify          # typecheck + test + raw-hex gate — what CI runs
npm run db:start        # local Supabase; also db:stop, db:status, db:reset, db:diff
```

Tests run on **ts-jest** in a `node` environment with no React Native preset (`jest.config.js`);
`jest-expo` is a devDependency but is *not* wired up. A suite touching a native component must
`jest.mock` each native module in its import graph (`react-native`, `react-native-svg`,
`expo-image`, …) — existing suites show the pattern.

**Never run `supabase db push`.** Migrations apply against a local stack (`npm run db:start`,
`npm run db:reset`) and reach production only via the `deploy-migrations` workflow on merge,
behind a required review.

## State boundary

Server data belongs in **TanStack Query**. `AppContext` holds only UI state no server owns —
`theme`, `toasts`, `tooltip`, `isViewingStory`. Putting server data back into `AppContext` is
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

Like, Save, Follow and Repost are one operation — an optimistic boolean toggle over a join
table with a count — so they share **one** generic helper. Four hand-written variants is the
thing this pattern exists to prevent.

## Styling

Once `theme/tokens.ts` lands (M1a) it is the single source of truth, and NativeWind classes and
inline styles both resolve to it. **No raw hex in components.** `npm run verify` enforces this
via `scripts/check-no-raw-hex.sh`, scoped to `theme/`, `lib/`, `features/` and
`components/native/ui/` — clean from birth. Screens under `app/` and `components/native/` still
hold inline hex and are cleaned up by the M1c re-skin tickets. Add `// allow-hex` only when a
literal colour is genuinely required.

## Vocabulary

Use these exactly — as table names, variable names, and user-facing labels.

| Term | Meaning |
| -- | -- |
| **Tag** | A portal linking to exactly one Destination. Never the destination itself. |
| **Physical Tag** | A QR code in the real world. Always-on; anyone can scan it without the owner present. |
| **Digital Tag** | A Tag shared from inside the app as a short link. The owner shares it deliberately. |
| **Embedded Tag** | A Tag inside a post, shown as a Tag Dot. Created during post creation. |
| **Tag Dot** | The pin indicator on a post image marking an Embedded Tag. Tapped, never scanned. |
| **Destination** | What a Tag points to. Exactly four kinds: Business Profile, Individual Profile, Product, Project. |
| **Tag Resolution** | Reading a Tag, identifying its Destination, routing there, recording the Scan. |
| **Scan** | Reading a Physical Tag with the camera. Applies to Physical Tags only. |
| **Scan History** | A user's private log of Tags they scanned. Private by default; opt-in to public. |
| **Profile** | A presence on the platform. Either a Business Profile or an Individual Profile. |
| **Product** | A shoppable, taggable catalog item listed by a Business Profile. |
| **Project** | A build, install or completed work. Can link many Contributors and Products. |
| **Contributor** | A Profile Linked to a Project as participant or supplier. **Never "vendor".** |
| **Linked** | The verb for connections between entities. Not "attached", "connected", or "associated". |
| **Save** | Bookmarking a Product, Project, or Profile. Not "favorite", "bookmark", or "like". |
| **OneSnap** | Ephemeral 24-hour content. Renders as a **square card, never a circle**. |
| **Waterfall Discovery** | Navigating down through connected content. Every page must offer somewhere to go next. |

Avoid: *vendor* → Contributor · *favorite* / *bookmark* → Save · *story* → OneSnap in new copy.

## Two locked decisions that change how you write code

Settled — don't relitigate in a ticket; raise a comment instead. Reasoning in the Working
Agreement, along with the rest.

- **Auth user id ≠ profile id** (after M3). An account may hold both a Business and an
  Individual Profile on the single `profiles` table. Content is attributed to the **active
  profile**, never the auth user — but **storage upload paths stay keyed by the auth user id**,
  because storage RLS gates on `auth.uid()` appearing in the folder name.
- **Tag URLs are built in exactly one place**, `lib/tagLinks.ts`, from
  `EXPO_PUBLIC_TAG_BASE_URL`. Never hardcode or assemble one elsewhere — these get printed onto
  physical objects and cannot be changed afterwards.

Migration is strangler-style: **the app must run correctly after every ticket.**

## Permanently out of scope

Not part of this plan, however much the reference design documents describe them — those
documents are disposable inspiration, not a mandate: Stripe and all payment processing ·
checkout, carts, orders · affiliate links, commission calculation, attribution windows,
payouts · leads inbox and quote requests · team permission seats and role-based business
access · brand partnership marketplace, campaigns, gifted products · multi-seller product
pages · NFC (QR only; `expo-camera` is already installed)

A Product here is a catalog item and a Tag Destination. **It is not a thing you can buy.** If a
ticket seems to lead toward any of these, stop at the boundary and note it on the ticket.

## Definition of done

1. `npx tsc --noEmit` passes
2. `npm test` passes
3. Every acceptance criterion on the ticket demonstrably met
4. No new raw hex, no new server state in `AppContext`
5. App boots: `npx expo start`
