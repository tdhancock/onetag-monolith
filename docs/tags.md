# Tags

What a Tag can point to, who may make one, and what happens when someone opens it. The words
are the Working Agreement's: a **Tag** is a portal to exactly one **Destination**.

## Five kinds of Destination

A Business Profile, an Individual Profile, a Product, a Project, or a Post. Post became the fifth
kind on 2026-09-28, reversing ONE-83: a post's link is a tag as much as a profile's is
(`supabase/migrations/20260928235000_post_destinations.sql`).

`tags` holds one destination column per kind — `dest_profile_id`, `dest_product_id`,
`dest_project_id`, `dest_post_id` — and `tags_one_destination` requires exactly one. A tag's
destination and short code never change once it exists (`protect_tag_identity`): print a new tag
rather than repoint an old one. Deleting the destination deletes the tags that point to it.

A new kind adds its column to both of those, a route in `lib/screens/tagResolution.ts`, a picker
option in `lib/screens/composeTags.ts`, and a card in `supabase/functions/tag-resolve`.

## Who may point a tag at what

| Tag | Made from | May point to |
| -- | -- | -- |
| **Physical** (a QR code) | Tags, in the app | Only your own: your profile, your products and projects, your posts |
| **Digital** (a short link) | Share on the destination | The same: only your own |
| **Embedded** (a point on a photo) | Composing or editing a photo post | Any profile, product, project or post you can see, except the photo's own post |

An embedded tag belongs to the post's author. The owner of the destination it points to can take
it off their thing too, as a product's or project's owner always could. RLS enforces all of it;
`supabase/tests/tags_and_scans.test.sql` and `post_destinations.test.sql` pin it.

The picker for an embedded tag searches profiles, products and projects by name, and posts by
their text and by their author's handle, so a photo post with no caption can still be found.

## Opening a tag

Every tag URL is built in `lib/tagLinks.ts` and only there: `<EXPO_PUBLIC_TAG_BASE_URL>/t/<code>`.
They are printed on physical things and can never change.

- **In the app** — the camera, a tapped embedded tag, or a tag link the OS hands to OneTag —
  `app/t/[shortCode].tsx` resolves it with `resolve_tag`, records the Scan, and replaces itself
  with the destination's screen.
- **Signed out, in the app**, product and project pages open as they are. A post asks the
  stranger to join, since posts are for people with an account.
- **In a browser, without the app**, the tag host serves `supabase/functions/tag-resolve`: a
  page naming the destination, with a way into the app. A post is named by its author's
  handle, since the page can't read the post itself.

`docs/deep-links.md` covers how the link reaches the app, and how to check universal links.

## Scan History

Only a scan of a Physical Tag is a Scan. Each goes in the scanner's private history, which they
may make public. A scanned post is listed as "Post by @handle", never by its text: the history
may be public when the post isn't.
