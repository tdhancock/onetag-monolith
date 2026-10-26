# Demo

A walkthrough of OneTag for one presenter on one phone, and the seed behind it:
`supabase/seeds/demo.sql`, content owned by a real account so it can be edited, logged and
approved during the demo. It sits on top of the development seed ([seed-data.md](seed-data.md)),
which supplies everyone else in it.

## Before the demo

1. **Load it** into the hosted dev project, owned by your account:

   ```bash
   pnpm db:seed:hosted --follow <your username> --demo <your username>
   ```

   That loads the dev seed (a no-op if it's already there), follows the seed profiles so Home
   fills, then loads the demo. Running it again adds only what's missing.

2. **Point tags at the tag host.** The QR codes the app draws are built from
   `EXPO_PUBLIC_TAG_BASE_URL` when the update is bundled, so the preview environment on EAS has
   to name the host that answers (the workers.dev Worker until there's a domain):

   ```bash
   npx eas-cli@latest env:list --environment preview
   ```

   The tag host builds its own page links from the `tag-resolve` function's `TAG_BASE_URL`
   secret. Set it to the same URL, or link previews point at the default `onetag.app`:

   ```bash
   npx supabase secrets set TAG_BASE_URL=<tag host> --project-ref pyxqcqfpbaaszwmmkryc
   ```

3. **Publish** for Expo Go ([testing-with-expo-go.md](testing-with-expo-go.md)):

   ```bash
   pnpm publish:preview --message "Demo"
   ```

4. **Print the stickers.** Open Tags in the app and print the sheet, or show a tag's QR on a
   second screen. The furnace's (`DemoFurn`) and the AC's (`DemoAirC`) are the ones scanned on
   stage; stick them on something.

## The walkthrough

About fifteen minutes. Each step names what the seed put there for it.

**1. The social basics.** Home shows the seed's people. Your posts have likes and comments
already: the Defender post (Marcus and Riley, with Ridgeline answering Riley in a thread), the
shakedown run (Jordan asks where it is), the dining room light (Leo and Nora). Notifications
holds them, and each opens where it's about. Messages has Marcus about fitting the rack, and
two unread from Timberline Homes about the house. Post a photo live and pin a tag on it; post a
OneSnap, since a seeded one would have expired.

**2. Two profiles.** Switch to your business profile, Swoop Garage: its own posts, a product
(the winch mount plate), and it's a Contributor on the Defender. What you post now is the
garage's.

**3. The Defender.** Open the Defender post and tap its tags: the roof rack, the suspension
lift, the winch, Ridgeline Overland. Each part is a project inside the truck, with details
(rated pull, lift height, fitted dates), and the truck's page lists them. Contributors:
Ridgeline as supplier, Marcus as mechanic, the garage for the restoration. The log runs from
"Bought her" through the lift, the rack and the light bar to the winch mount, round one and
round two, with a photo. Ridgeline's products are Linked, so the rack leads to the store's page
and on to its other products: somewhere to go next, every time.

**4. The house.** Scan the furnace sticker with the in-app camera. The furnace opens: model,
filter size, warranty, the manual, and five years of service, mostly Timberline's. Up to the
house: Unlisted, so it's on no profile, but the sticker opened it. Inside it, the AC and the
water heater. The AC has a tune-up Timberline proposed after scanning its sticker: approve it,
and Timberline becomes a Contributor.

**5. Without the app.** Scan a sticker with the phone's own camera: the tag host's page, with
**Open in OneTag**. Scan History has the tags you've opened. Then the tags dashboard, and link
one of the two blank stickers (`DemoNew2`, `DemoNew3`) to something.

## What's in it

| | |
| -- | -- |
| **Business profile** | The account's own, named Swoop Garage while its name is still its username. One is made if the account has none. A product: the winch mount plate |
| **The Defender** | *'97 Defender 110*, public, with five parts inside it: suspension lift, roof rack, winch, light bar, interior refit. Details on each, Contributors, Ridgeline's rack, light bar and recovery kit Linked, and an eight-entry log |
| **The house** | *Our house*, Unlisted, with a furnace, an air conditioner and a water heater inside it. Details, a log on each, Lumen Works Linked for the dining room light, and Timberline's proposed AC tune-up |
| **Posts** | Five from you and two from the garage, with eight tags on them |
| **Around them** | Ten comments, likes from the seed's people, a repost, saves, follows, and five messages |
| **Scan History** | Three of the dev seed's tags |

Physical Tags, each with a fixed code. Open `<tag host>/t/<code>`, or scan it:

| Code | Points to |
| -- | -- |
| `DemoRig2` | The Defender |
| `DemoHaus` | The house |
| `DemoFurn` | The furnace |
| `DemoAirC` | The air conditioner. Timberline scanned this one |
| `DemoShop` | The business profile |
| `DemoNew2`, `DemoNew3` | Nothing yet: blank, to link during the demo |

Photos are picsum's, by id, chosen because they show what they're used for: 514 is the
Defender, 551 the shakedown run, 491 the winch mount, 605 and 1070 interiors, 946 the house,
625 the dining room, 1071 the garage's other car. Picsum has no furnace or AC unit, so those
have no photos; take one of a real one and log it during the demo.

## Removing it

Every demo row's id starts `dea0`:

```sql
delete from public.tags where id::text like 'dea0%';
delete from public.posts where id::text like 'dea0%';
delete from public.projects where id::text like 'dea0%';
delete from public.products where id::text like 'dea0%';
delete from public.messages where id::text like 'dea0%';
delete from public.profiles where id::text like 'dea0%';
```

Comments, likes, details, logs and the rest go with what they belong to. The business
profile's new name, bio and avatar stay; change them in the app. The follows, saves and Scans
it added between your account and the dev seed go when the dev seed does.
