# `features/` — the data domain pattern

Every data domain in OneTag takes the same shape. The point is that the domain
migration tickets are short and identical: nobody has to decide where a
Supabase call or a query key lives, because the answer is already here.

`features/hashtags/` is the worked example. It is deliberately the smallest
domain in the app — one read, no mutations, no optimistic updates, no realtime
— so it shows the structure without burying it in domain logic. Copy it.

## Shape

```
features/<domain>/
  api.ts        pure Supabase functions. No React, no hooks.
  keys.ts       this domain's query keys
  queries.ts    useXQuery hooks wrapping api.ts
  mutations.ts  useXMutation hooks
  types.ts      domain types
  index.ts      the public surface
```

A domain with no mutations has no `mutations.ts` — `features/hashtags/` does
not have one. Do not add an empty file to match the list.

## The three rules

**1. `api.ts` imports nothing from React and nothing from another feature.**

It may import the Supabase client from `services/`, and its own `./types`.
That keeps every query callable from a hook, a script or a test without
dragging a renderer along, and it is what lets the domain's real logic be
tested in this repo's node-environment Jest setup.

If one domain's API genuinely needs another's, that is a signal the boundary
is in the wrong place. Raise it on the ticket rather than importing across.

**2. Everything outside a domain imports only from `features/<domain>`.**

That is the `index.ts` barrel. Never reach into `features/posts/api` from a
screen or from another feature. The barrel is what lets a domain be reshaped
without touching its callers.

**3. Query keys are built only in `keys.ts`.**

A raw array key literal anywhere else — a screen, a hook, a mutation's
`invalidateQueries` call — is a bug. `keys.ts` calls `createQueryKeys` from
`lib/queryKeys.ts`, which is the single place the key *shape* is defined.

## Why the key shape matters

TanStack Query matches queries by key **prefix**. `createQueryKeys` builds
`lists()` and `details()` out of `all` rather than repeating the domain
string, so containment is structural:

```ts
const postKeys = createQueryKeys('posts');

postKeys.all                    // ['posts']
postKeys.lists()                // ['posts', 'list']
postKeys.list({ userId: 'u1' }) // ['posts', 'list', { userId: 'u1' }]
postKeys.details()              // ['posts', 'detail']
postKeys.detail('p1')           // ['posts', 'detail', 'p1']
```

Invalidating `postKeys.all` invalidates every key beneath it; invalidating
`postKeys.lists()` invalidates the lists and leaves cached details alone. That
is the whole reason to have a factory instead of writing arrays by hand — a
mutation can choose how widely to invalidate without anyone reasoning about
array prefixes at the call site.

A domain needing keys beyond the five builds them from `all` so they stay
inside the hierarchy:

```ts
export const postKeys = {
  ...createQueryKeys('posts'),
  feed: () => [...createQueryKeys('posts').all, 'feed'] as const,
};
```

## Server state belongs here, not in AppContext

`store/AppContext.native.tsx` holds only UI state no server owns — `theme`,
`toasts`, `tooltip`, `topNotification`, `isViewingStory`, and the per-device
`viewedStoryTimestamps`. Even the auth session is a query (`features/auth`).
Anything fetched from Supabase belongs
in a feature folder behind a query hook. If a ticket asks you to put server
data back into `AppContext`, the ticket is wrong — say so on the ticket rather
than working around it.

## Shared ground: `services/`

M2 finished in ONE-20: every function that used to live in one shared service
module now lives in a feature, and that module is gone. What a feature's
`api.ts` shares with another feature sits in `services/` instead, where rule 1
lets every feature reach it:

- `services/postRows.ts` — the post select and row mapper, for anything that
  embeds a post (messages, profiles)
- `services/notificationWrites.ts` — inserting a notification
- `services/profileBootstrap.ts` — making sure a profile row exists
- `services/mediaUpload.ts`, `services/storyUpload.ts` — storage uploads

If a new feature needs something another feature's `api.ts` has, move it to
`services/` rather than importing across.
