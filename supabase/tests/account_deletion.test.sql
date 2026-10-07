-- Deleting an account (ONE-88). delete-user-account deletes the auth user and
-- nothing else, relying on the cascade: profiles.user_id to the account, and
-- every profile-owned row to its profile. This deletes an account holding an
-- Individual and a Business profile, with content on both, and checks nothing
-- either profile owned is left. Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account X: individual XI (signup) and business XB. The account deleted.
--            XI has also reviewed a report, as an admin would, and has
--            liked and commented on XB's post.
-- Account Y: individual YI, who follows, messages, tags, contributes and
--            reports alongside X.
-- Account Z: individual ZI, who receives a message from Y sharing XB.

BEGIN;
SELECT plan(24);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000088', 'x@one88.test', '{"username":"one88_x"}'),
  ('bbbbbbbb-0000-0000-0000-000000000088', 'y@one88.test', '{"username":"one88_y"}'),
  ('cccccccc-0000-0000-0000-000000000088', 'z@one88.test', '{"username":"one88_z"}');

INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000088', 'business', 'one88_x_biz', 'X Works');
INSERT INTO public.business_profiles (profile_id) SELECT id FROM public.profiles WHERE username = 'one88_x_biz';

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  'aaaaaaaa-0000-0000-0000-000000000088'::uuid AS x,
  'bbbbbbbb-0000-0000-0000-000000000088'::uuid AS y,
  'cccccccc-0000-0000-0000-000000000088'::uuid AS z,
  (SELECT id FROM public.profiles WHERE username = 'one88_x') AS xi,
  (SELECT id FROM public.profiles WHERE username = 'one88_x_biz') AS xb,
  (SELECT id FROM public.profiles WHERE username = 'one88_y') AS yi,
  (SELECT id FROM public.profiles WHERE username = 'one88_z') AS zi,
  'f0000000-0000-0000-0000-000000000881'::uuid AS post_xi,
  'f0000000-0000-0000-0000-000000000882'::uuid AS post_xb,
  'f0000000-0000-0000-0000-000000000883'::uuid AS post_y,
  'f0000000-0000-0000-0000-000000000884'::uuid AS comment_y,
  'f0000000-0000-0000-0000-000000000885'::uuid AS story_xb,
  'f0000000-0000-0000-0000-000000000886'::uuid AS story_y,
  'f0000000-0000-0000-0000-000000000887'::uuid AS product_xb,
  'f0000000-0000-0000-0000-000000000888'::uuid AS project_xi,
  'f0000000-0000-0000-0000-000000000889'::uuid AS project_y,
  'f0000000-0000-0000-0000-00000000088a'::uuid AS tag_xb,
  'f0000000-0000-0000-0000-00000000088b'::uuid AS tag_y,
  'f0000000-0000-0000-0000-00000000088c'::uuid AS tag_embedded;

-- Posts, likes, reposts and comments, both ways.
INSERT INTO public.posts (id, user_id, content) SELECT post_xi, xi, 'from XI' FROM ids;
INSERT INTO public.posts (id, user_id, content) SELECT post_xb, xb, 'from XB' FROM ids;
INSERT INTO public.posts (id, user_id, image_url, media_type) SELECT post_y, yi, 'https://example.test/y.jpg', 'image' FROM ids;
INSERT INTO public.likes (post_id, user_id) SELECT post_y, xi FROM ids;
INSERT INTO public.likes (post_id, user_id) SELECT post_xi, yi FROM ids;
INSERT INTO public.reposts (post_id, user_id) SELECT post_y, xb FROM ids;
INSERT INTO public.comments (post_id, user_id, content) SELECT post_y, xb, 'XB on Y' FROM ids;
INSERT INTO public.comments (post_id, user_id, content) SELECT post_xi, yi, 'Y on XI' FROM ids;
INSERT INTO public.comments (id, post_id, user_id, content) SELECT comment_y, post_y, yi, 'Y on Y' FROM ids;
INSERT INTO public.comment_likes (comment_id, user_id) SELECT comment_y, xi FROM ids;
-- One profile engaging with the other's post: both go in the one delete, and
-- each of these moves the Explore totals of a post that is going too (ONE-104).
INSERT INTO public.likes (post_id, user_id) SELECT post_xb, xi FROM ids;
INSERT INTO public.comments (post_id, user_id, content) SELECT post_xb, xi, 'XI on XB' FROM ids;

-- Follows, OneSnaps, notifications and messages.
INSERT INTO public.follows (follower_id, followed_id) SELECT xi, yi FROM ids;
INSERT INTO public.follows (follower_id, followed_id) SELECT yi, xb FROM ids;
INSERT INTO public.stories (id, user_id, media_url) SELECT story_xb, xb, 'https://example.test/xb.jpg' FROM ids;
INSERT INTO public.stories (id, user_id, media_url) SELECT story_y, yi, 'https://example.test/ys.jpg' FROM ids;
INSERT INTO public.story_views (story_id, user_id) SELECT story_xb, yi FROM ids;
INSERT INTO public.story_likes (story_id, user_id) SELECT story_y, xi FROM ids;
INSERT INTO public.notifications (sender_id, receiver_id, type) SELECT yi, xi, 'follow' FROM ids;
INSERT INTO public.notifications (sender_id, receiver_id, type, post_id) SELECT xb, yi, 'like', post_y FROM ids;
INSERT INTO public.messages (sender_id, receiver_id, text) SELECT xi, yi, 'hi' FROM ids;
INSERT INTO public.messages (sender_id, receiver_id, text) SELECT yi, xb, 'hey' FROM ids;
INSERT INTO public.messages (sender_id, receiver_id, type, shared_profile_id) SELECT yi, zi, 'profile_share', xb FROM ids;

-- Saves, a product, projects and Contributors.
INSERT INTO public.saves (profile_id, saved_post_id) SELECT xi, post_y FROM ids;
INSERT INTO public.saves (profile_id, saved_profile_id) SELECT yi, xb FROM ids;
INSERT INTO public.products (id, business_profile_id, name) SELECT product_xb, xb, 'Door' FROM ids;
INSERT INTO public.product_media (product_id, url) SELECT product_xb, 'https://example.test/door.jpg' FROM ids;
INSERT INTO public.product_specs (product_id, label, value) SELECT product_xb, 'Wood', 'Oak' FROM ids;
INSERT INTO public.projects (id, owner_profile_id, name) SELECT project_xi, xi, 'X build' FROM ids;
INSERT INTO public.projects (id, owner_profile_id, name) SELECT project_y, yi, 'Y build' FROM ids;
INSERT INTO public.contributors (project_id, contributor_profile_id) SELECT project_xi, yi FROM ids;
INSERT INTO public.contributors (project_id, contributor_profile_id) SELECT project_y, xb FROM ids;
INSERT INTO public.project_products (project_id, product_id) SELECT project_y, product_xb FROM ids;

-- Tags and Scans: XB's own tag, Y's tag, and Y's post tagging XB's product.
INSERT INTO public.tags (id, owner_profile_id, tag_type, format, dest_profile_id)
SELECT tag_xb, xb, 'physical', 'qr', xb FROM ids;
INSERT INTO public.tags (id, owner_profile_id, tag_type, format, dest_profile_id)
SELECT tag_y, yi, 'physical', 'qr', yi FROM ids;
INSERT INTO public.tags (id, owner_profile_id, tag_type, dest_product_id, host_post_id, tag_x_pct, tag_y_pct)
SELECT tag_embedded, yi, 'embedded', product_xb, post_y, 40, 60 FROM ids;
INSERT INTO public.scans (tag_id, scanner_profile_id) SELECT tag_xb, yi FROM ids;
INSERT INTO public.scans (tag_id, scanner_profile_id) SELECT tag_y, xi FROM ids;

-- Reports: one X filed, and one X reviewed (ONE-98). Then a push token, and
-- blocks both ways: the last two on the account.
INSERT INTO public.reports (reporter_id, target_type, target_id, reason) SELECT xi, 'post', post_y, 'spam' FROM ids;
INSERT INTO public.reports (reporter_id, target_type, target_id, reason, status, reviewed_at, reviewed_by)
SELECT yi, 'user', zi, 'impersonation', 'reviewed', now(), xi FROM ids;
INSERT INTO public.push_tokens (user_id, token) SELECT x, 'ExponentPushToken[one88]' FROM ids;
INSERT INTO public.blocks (blocker_id, blocked_id) SELECT x, y FROM ids;
INSERT INTO public.blocks (blocker_id, blocked_id) SELECT z, x FROM ids;

-- ─── What delete-user-account does: delete the auth user ──────────────

SELECT lives_ok($$DELETE FROM auth.users WHERE id = (SELECT x FROM ids)$$,
  'the account deletes, though one of its profiles liked and commented on the other''s post');

-- ─── Nothing either profile owned is left ─────────────────────────────

SELECT is((SELECT count(*) FROM public.profiles p, ids WHERE p.user_id = ids.x), 0::bigint,
  'both of the account''s profiles are gone');

SELECT is((SELECT count(*) FROM public.business_profiles b, ids WHERE b.profile_id = ids.xb), 0::bigint,
  'the business profile''s fields are gone');

SELECT is((SELECT count(*) FROM public.posts p, ids WHERE p.user_id IN (ids.xi, ids.xb)), 0::bigint,
  'posts by either profile are gone');

SELECT is((SELECT count(*) FROM public.likes l, ids
           WHERE l.user_id IN (ids.xi, ids.xb) OR l.post_id IN (ids.post_xi, ids.post_xb)), 0::bigint,
  'likes by either profile, and on their posts, are gone');

SELECT is((SELECT count(*) FROM public.reposts r, ids WHERE r.user_id IN (ids.xi, ids.xb)), 0::bigint,
  'reposts by either profile are gone');

SELECT is((SELECT count(*) FROM public.comments c, ids
           WHERE c.user_id IN (ids.xi, ids.xb) OR c.post_id IN (ids.post_xi, ids.post_xb)), 0::bigint,
  'comments by either profile, and on their posts, are gone');

SELECT is((SELECT count(*) FROM public.comment_likes c, ids WHERE c.user_id IN (ids.xi, ids.xb)), 0::bigint,
  'comment likes by either profile are gone');

SELECT is((SELECT count(*) FROM public.follows f, ids
           WHERE ids.xi IN (f.follower_id, f.followed_id) OR ids.xb IN (f.follower_id, f.followed_id)), 0::bigint,
  'follows either way are gone');

SELECT is((SELECT count(*) FROM public.stories s, ids WHERE s.user_id IN (ids.xi, ids.xb))
        + (SELECT count(*) FROM public.story_views v, ids WHERE v.user_id IN (ids.xi, ids.xb) OR v.story_id = ids.story_xb)
        + (SELECT count(*) FROM public.story_likes l, ids WHERE l.user_id IN (ids.xi, ids.xb)), 0::bigint,
  'OneSnaps, their views, and likes by either profile are gone');

SELECT is((SELECT count(*) FROM public.notifications n, ids
           WHERE ids.xi IN (n.sender_id, n.receiver_id) OR ids.xb IN (n.sender_id, n.receiver_id)), 0::bigint,
  'notifications sent or received are gone');

SELECT is((SELECT count(*) FROM public.messages m, ids
           WHERE ids.xi IN (m.sender_id, m.receiver_id) OR ids.xb IN (m.sender_id, m.receiver_id)), 0::bigint,
  'messages sent or received are gone');

SELECT is((SELECT count(*) FROM public.saves s, ids
           WHERE s.profile_id IN (ids.xi, ids.xb) OR s.saved_profile_id IN (ids.xi, ids.xb)), 0::bigint,
  'saves by either profile, and saves of them, are gone');

SELECT is((SELECT count(*) FROM public.products p, ids WHERE p.business_profile_id = ids.xb)
        + (SELECT count(*) FROM public.product_media m, ids WHERE m.product_id = ids.product_xb)
        + (SELECT count(*) FROM public.product_specs s, ids WHERE s.product_id = ids.product_xb), 0::bigint,
  'the business''s products, with their media and specs, are gone');

SELECT is((SELECT count(*) FROM public.projects p, ids WHERE p.owner_profile_id IN (ids.xi, ids.xb))
        + (SELECT count(*) FROM public.contributors c, ids
           WHERE c.contributor_profile_id IN (ids.xi, ids.xb) OR c.project_id = ids.project_xi)
        + (SELECT count(*) FROM public.project_products pp, ids WHERE pp.product_id = ids.product_xb), 0::bigint,
  'their projects, their Contributor links, and the product''s links to other projects are gone');

SELECT is((SELECT count(*) FROM public.tags t, ids
           WHERE t.owner_profile_id IN (ids.xi, ids.xb) OR t.dest_profile_id IN (ids.xi, ids.xb)
              OR t.dest_product_id = ids.product_xb), 0::bigint,
  'tags they own, and tags pointing at them, are gone, including one in another account''s post');

SELECT is((SELECT count(*) FROM public.scans s, ids WHERE s.tag_id = ids.tag_xb OR s.scanner_profile_id IN (ids.xi, ids.xb)),
  0::bigint,
  'scans of their tags are gone, and no scan names them');

SELECT is((SELECT count(*) FROM public.reports r, ids WHERE r.reporter_id IN (ids.xi, ids.xb)), 0::bigint,
  'reports they filed are gone');

SELECT is((SELECT count(*) FROM public.push_tokens p, ids WHERE p.user_id = ids.x)
        + (SELECT count(*) FROM public.blocks b, ids WHERE ids.x IN (b.blocker_id, b.blocked_id)), 0::bigint,
  'the account''s push token and blocks either way are gone');

-- ─── What outlives the account, by design ─────────────────────────────

SELECT is((SELECT count(*) FROM public.scans s, ids WHERE s.tag_id = ids.tag_y AND s.scanner_profile_id IS NULL), 1::bigint,
  'a scan they made stays in the tag owner''s counts, with no scanner');

SELECT is((SELECT count(*) FROM public.messages m, ids
           WHERE m.sender_id = ids.yi AND m.receiver_id = ids.zi AND m.shared_profile_id IS NULL), 1::bigint,
  'a message between two other people that shared their profile stays, without the profile');

SELECT is((SELECT count(*) FROM public.reports r, ids
           WHERE r.reporter_id = ids.yi AND r.status = 'reviewed' AND r.reviewed_by IS NULL), 1::bigint,
  'a report they reviewed stays reviewed, with no reviewer, and did not stop the deletion');

SELECT ok(
  EXISTS (SELECT 1 FROM public.profiles p, ids WHERE p.id = ids.yi)
  AND EXISTS (SELECT 1 FROM public.posts p, ids WHERE p.id = ids.post_y)
  AND EXISTS (SELECT 1 FROM public.projects p, ids WHERE p.id = ids.project_y)
  AND EXISTS (SELECT 1 FROM public.tags t, ids WHERE t.id = ids.tag_y),
  'the other account keeps its profile, post, project and tag');

-- ─── Every foreign key to a profile or an account says what happens ───
--
-- The cascade above holds only while each one does. These are the ones that
-- don't cascade, each set null on purpose. A NO ACTION key here would stop an
-- account's deletion outright, as reviewed_by did until ONE-98. A log entry
-- (ONE-141) is its project owner's record, so it outlives who did the work.

-- confdeltype: c cascade, n set null, a no action.
SELECT is(
  (SELECT array_agg(fk ORDER BY fk)
   FROM (
     SELECT format('%s.%s %s', k.conrelid::regclass, a.attname, k.confdeltype) COLLATE "C" AS fk
     FROM pg_constraint k
     JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
     WHERE k.contype = 'f'
       AND k.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass)
       AND k.connamespace = 'public'::regnamespace
       AND k.confdeltype <> 'c'
   ) fks),
  ARRAY[
    'messages.shared_profile_id n',
    'project_log_entries.performed_by_profile_id n',
    'reports.reviewed_by n',
    'scans.scanner_profile_id n'
  ],
  'every other foreign key to a profile or an account cascades');

SELECT * FROM finish();
ROLLBACK;
