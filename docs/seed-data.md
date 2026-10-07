# Seed data

Made-up people, businesses and content, so the app has something to show while it's being
built. It goes into the local stack and the hosted dev project. **Never production**:
production will be a new project that starts empty.

The data is `supabase/seeds/dev.sql`, and `scripts/seed.cjs` runs it.

## Loading it

```bash
pnpm db:seed
```

That's the local stack, which has to be running (`pnpm db:start`). For the hosted dev
project:

```bash
pnpm db:seed:hosted
```

The hosted run names the dev project's ref on every call instead of using whatever the CLI
is linked to, so it can't reach any other project. It still needs the CLI signed in
(`npx supabase login`).

Your own account doesn't follow anyone in the seed, and Home shows only the people you
follow. To fill it, name your account:

```bash
pnpm db:seed:hosted --follow <your username>
```

`account_found: 0` in the output means no profile has that username.

Running it again is safe. Every row has a fixed id or a natural key, and an insert skips a
row that's already there. A re-run therefore adds only what's missing, and it never
changes a row that exists. To change seed rows that are already loaded, remove the seed and
load it again.

## What's in it

| | |
| -- | -- |
| **People** | `maya.builds`, `jordan.trails`, `sam.studio`, `riley.overland`, `casey.makes`, `theo.frames`, and the four business owners, `nora.lee`, `marcus.hale`, `priya.nair`, `leo.vance` |
| **Businesses** | `timberline.homes` (custom homes), `ridgeline.overland` (vehicle outfitter), `ironform.supply` (outdoor gear), `lumen.works` (lighting studio), each a Business Profile on its owner's account |
| **Posts** | 34: 31 photo posts across the six interests, and 3 text posts, dated over the last four weeks |
| **Products** | 12, three for each business, each with a photo |
| **Projects** | 6, with Contributors and Linked products, and a home record: Maya's Unlisted *Maple Street House*, with a furnace and a water heater inside it, their details and a log. Timberline Homes is the furnace's Contributor and logs its service; Lumen Works scanned the house's tag and proposed an entry, waiting for Maya |
| **Tags** | 8 Physical Tags with fixed codes (below), and 13 embedded tags on photo posts, one of which points to another post |
| **Around them** | 45 follows among the seed profiles, 15 comments with replies, likes, reposts and saves |

The eight Physical Tags use fixed codes, so their links are known without printing anything.
Open `<tag host>/t/<code>`, or scan a QR code of it:

| Code | Points to |
| -- | -- |
| `SeedHome` | Timberline Homes, a Business Profile |
| `SeedRig2` | Ridgeline Overland, a Business Profile |
| `SeedGear` | Everyday carry kit, a Product |
| `SeedLamp` | Festoon light string, a Product |
| `SeedCabn` | Lakeside Cabin, a Project |
| `SeedPost` | Lumen Works' night market post, a Post |
| `SeedHaus` | Maple Street House, an Unlisted Project: opening it lets you read the house and what's in it |
| `SeedFurn` | The house's furnace, an Unlisted Project inside it |

There are no OneSnaps, because a OneSnap expires after a day.

**Photos** are hot-linked from [picsum.photos](https://picsum.photos) by fixed id, so every
run shows the same pictures and nothing is uploaded to storage. If picsum is down, they
don't load. Post photos come without the blurred preview that Supabase-hosted images get
(`services/postRows.ts`).

## Signing in as a seed account

Nobody can. Each seed account's password is a random value that was never stored. To act
as one, set a password for it in the dashboard's SQL editor (dev project only), with a
password you choose:

```sql
update auth.users
set encrypted_password = extensions.crypt('<a password>', extensions.gen_salt('bf'))
where email = 'nora.lee@example.com';
```

A seed account's email is its username at `example.com`. Nora's account holds both
`nora.lee` and the `timberline.homes` Business Profile.

## Removing it

Every seed account's id starts `5eed0a00-`, and everything else in the seed belongs to one
of those accounts. Deleting the accounts deletes all of it:

```sql
delete from auth.users where id::text like '5eed0a00-%';
```

Follows your own account made with `--follow` go with them.

## Changing it

Ids are fixed, with one prefix for each kind: `5eed0a00-` accounts, `5eed0b00-` business
profiles, `5eed0c00-` posts, `5eed0d00-` products, `5eed0600-` product photos, `5eed0e00-`
projects, `5eed0f00-` comments, `5eed0700-` tags, `5eed0800-` project details and `5eed0900-`
log entries. The last twelve digits are the row's
number in the file. Give a new row the next free number.

The file is a single `do` block, because `supabase db query` runs a file as one prepared
statement, which takes one command. It creates its helpers in the session's `pg_temp`
first, then adds the data in a nested block. Being one statement also makes it atomic:
either it all goes in or none of it does.

CI applies it twice to a clean local stack whenever something under `supabase/` changes,
after the pgTAP suite and the API checks. A migration that breaks the seed therefore fails
its own pull request.
