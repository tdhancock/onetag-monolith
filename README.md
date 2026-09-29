# OneTag

A React Native app where every profile, product, project and post has a **Tag**: a QR code in the
real world, a short link, or a point on a photo, and each one opens where it points. People follow,
post, comment, message and share 24-hour OneSnaps around them.

The app is the product. The web is only the page a scanned tag opens for someone without the app.

## Stack

Expo SDK 57 · React Native 0.86 · expo-router · NativeWind v4 · TanStack Query and Form ·
Supabase (Auth, Postgres with RLS, Storage, Realtime, Edge Functions) · TypeScript

## Getting started

Needs Node 22, and Docker Desktop for the local Supabase stack.

```bash
npm install
```

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | What it is |
| -- | -- |
| `EXPO_PUBLIC_SUPABASE_URL` | The Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Its anon key: public by design, and limited by RLS |
| `EXPO_PUBLIC_TAG_BASE_URL` | The host tag links are built on. They get printed on things, so it never changes once used |

```bash
npx expo start
```

Scan the QR code with Expo Go. Testers get published builds instead; see
[docs/testing-with-expo-go.md](docs/testing-with-expo-go.md).

An empty database shows an empty app. `npm run db:seed` loads made-up people, posts, products,
projects and tags into the local stack, and `npm run db:seed:hosted` loads them into the hosted
dev project; see [docs/seed-data.md](docs/seed-data.md).

## Checks

```bash
npm run verify
```

Typecheck, lint, Jest and the no-raw-colour gate: what CI runs. Against a local stack
(`npm run db:start`) there's also `npm run db:test` for the pgTAP suite and `npm run check:api`
for the data layer against a real database.

Migrations and edge functions reach production only through their deploy workflows on merge.
Never `supabase db push`.

## Layout

```
app/                 routes: every screen, and nothing else
components/native/   shared components; ui/ holds the token-only primitives
features/<domain>/   the data layer: api, keys, queries, mutations, one folder per domain
lib/                 query client, realtime bridge, pure logic (lib/screens holds screen rules)
services/            the Supabase client and what features share
theme/tokens.ts      every colour and type size
supabase/            migrations, pgTAP tests, edge functions, the dev seed
docs/                tags, deep links, push notifications, testing with Expo Go, seed data
```

## Working in the code

[CLAUDE.md](CLAUDE.md) holds the rules: the vocabulary, the feature-folder shape, what may live in
app state, styling, and the decisions that are settled. [features/README.md](features/README.md)
explains the data layer. Work is tracked in Linear; see [CONTRIBUTING.md](CONTRIBUTING.md) and
report security issues as [SECURITY.md](SECURITY.md) describes.
