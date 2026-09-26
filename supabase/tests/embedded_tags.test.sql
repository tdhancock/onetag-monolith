-- Embedded Tags: their positions, who reads them, who makes and removes
-- them, and resolve_tag refusing them (ONE-44). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account A: individual AI (signup). Author of image post POST.
-- Account B: business BB. Lists product BP; owns public project PUB and
--            private project PRIV.
-- Account C: individual CI. A stranger who views A's post.
-- Account D: individual DI, private. Author of post HIDDEN, which C cannot see.

BEGIN;
SELECT plan(22);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000044', 'a@one44.test', '{"username":"one44_a"}'),
  ('bbbbbbbb-0000-0000-0000-000000000044', 'b@one44.test', '{"username":"one44_b"}'),
  ('cccccccc-0000-0000-0000-000000000044', 'c@one44.test', '{"username":"one44_c"}'),
  ('dddddddd-0000-0000-0000-000000000044', 'd@one44.test', '{"username":"one44_d"}');

INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('bbbbbbbb-0000-0000-0000-000000000044', 'business', 'one44_b_biz', 'B Works');
INSERT INTO public.business_profiles (profile_id) SELECT id FROM public.profiles WHERE username = 'one44_b_biz';
UPDATE public.profiles SET is_private = true WHERE username = 'one44_d';

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one44_a') AS ai,
  (SELECT id FROM public.profiles WHERE username = 'one44_b_biz') AS bb,
  (SELECT id FROM public.profiles WHERE username = 'one44_c') AS ci,
  (SELECT id FROM public.profiles WHERE username = 'one44_d') AS di,
  'f0000000-0000-0000-0000-000000000441'::uuid AS post,
  'f0000000-0000-0000-0000-000000000442'::uuid AS hidden,
  'f0000000-0000-0000-0000-000000000443'::uuid AS bp,
  'f0000000-0000-0000-0000-000000000444'::uuid AS pub,
  'f0000000-0000-0000-0000-000000000445'::uuid AS priv;
GRANT SELECT ON ids TO authenticated, anon;

INSERT INTO public.posts (id, user_id, image_url, media_type)
SELECT post, ai, 'https://example.test/a.jpg', 'image' FROM ids;
INSERT INTO public.posts (id, user_id, image_url, media_type)
SELECT hidden, di, 'https://example.test/d.jpg', 'image' FROM ids;
INSERT INTO public.products (id, business_profile_id, name) SELECT bp, bb, 'Lamp' FROM ids;
INSERT INTO public.projects (id, owner_profile_id, name, is_public) SELECT pub, bb, 'Loft', true FROM ids;
INSERT INTO public.projects (id, owner_profile_id, name, is_public) SELECT priv, bb, 'Vault', false FROM ids;

-- D's own tag on the post C cannot see, and a physical tag of A's.
INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id, host_post_id, tag_x_pct, tag_y_pct)
SELECT di, 'embedded', bp, hidden, 10, 10 FROM ids;

-- ─── Shape: the checks, as the database owner ─────────────────────────

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id, host_post_id, tag_x_pct)
    SELECT ai, 'embedded', bp, post, 50 FROM ids$$,
  '23514', NULL, 'an embedded tag without both coordinates is rejected');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id, tag_x_pct, tag_y_pct)
    SELECT ai, 'embedded', bp, 50, 50 FROM ids$$,
  '23514', NULL, 'an embedded tag without a host post is rejected');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, format, dest_profile_id, tag_x_pct, tag_y_pct)
    SELECT ai, 'physical', 'qr', ai, 50, 50 FROM ids$$,
  '23514', NULL, 'a physical tag with coordinates is rejected');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id, host_post_id, tag_x_pct, tag_y_pct)
    SELECT ai, 'embedded', bp, post, 150, 50 FROM ids$$,
  '23514', NULL, 'an out-of-range percentage is rejected');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id, host_post_id, tag_x_pct, tag_y_pct, note)
    SELECT ai, 'embedded', bp, post, 50, 50, 'private' FROM ids$$,
  '23514', NULL, 'an embedded tag with a note is rejected');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, format, dest_product_id, host_post_id, tag_x_pct, tag_y_pct)
    SELECT ai, 'embedded', 'qr', bp, post, 50, 50 FROM ids$$,
  '23514', NULL, 'an embedded tag with a format is rejected');

-- ─── As A, the post's author ──────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000044","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id, host_post_id, tag_x_pct, tag_y_pct, short_code)
    SELECT ai, 'embedded', bp, post, 25.5, 40, 'EmbProd2' FROM ids$$,
  'the post''s author can tag another account''s product');

SELECT lives_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_profile_id, host_post_id, tag_x_pct, tag_y_pct)
    SELECT ai, 'embedded', bb, post, 60, 60 FROM ids$$,
  'the post''s author can tag another account''s profile');

SELECT lives_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_project_id, host_post_id, tag_x_pct, tag_y_pct)
    SELECT ai, 'embedded', pub, post, 0, 100 FROM ids$$,
  'the post''s author can tag another account''s public project');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_project_id, host_post_id, tag_x_pct, tag_y_pct)
    SELECT ai, 'embedded', priv, post, 50, 50 FROM ids$$,
  '42501', NULL, 'a private project can''t be tagged');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, format, dest_product_id)
    SELECT ai, 'physical', 'qr', bp FROM ids$$,
  '42501', NULL, 'a physical tag still may not point at another account''s product');

SELECT is(
  (SELECT count(*)::int FROM public.tags WHERE host_post_id = (SELECT post FROM ids)),
  3, 'the author reads the three tags on their post');

-- ─── As C, a stranger viewing A's post ────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000044","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id, host_post_id, tag_x_pct, tag_y_pct)
    SELECT ci, 'embedded', bp, post, 50, 50 FROM ids$$,
  '42501', NULL, 'nobody but the author can add a tag to the post');

SELECT is(
  (SELECT count(*)::int FROM public.tags WHERE host_post_id = (SELECT post FROM ids)),
  3, 'a viewer who can see the post reads its embedded tags');

SELECT is(
  (SELECT count(*)::int FROM public.tags WHERE host_post_id = (SELECT hidden FROM ids)),
  0, 'an embedded tag on a post the viewer can''t see is not readable');

SELECT is(
  (SELECT count(*)::int FROM public.resolve_tag('EmbProd2')),
  0, 'resolve_tag returns nothing for an embedded tag''s code');

SELECT lives_ok(
  $$INSERT INTO public.scans (tag_id, scanner_profile_id)
    SELECT t.id, i.ci FROM public.tags t, ids i WHERE t.short_code = 'EmbProd2'$$,
  'a tap is recorded as an ordinary scan');

DELETE FROM public.tags WHERE host_post_id = (SELECT post FROM ids);

-- ─── As B, whose product, profile and project are tagged ──────────────

SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000044","role":"authenticated"}', true);

DELETE FROM public.tags WHERE short_code = 'EmbProd2';

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.tags WHERE host_post_id = (SELECT post FROM ids)),
  2, 'a stranger deleted none of the post''s tags, and the product''s owner removed the one pointing at it');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000044","role":"authenticated"}', true);
DELETE FROM public.tags WHERE dest_profile_id = (SELECT bb FROM ids) AND tag_type = 'embedded';
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.tags WHERE host_post_id = (SELECT post FROM ids)),
  1, 'the tagged profile''s owner removed the tag pointing at them');

SELECT is(
  (SELECT count(*)::int FROM public.scans s JOIN public.tags t ON t.id = s.tag_id WHERE t.host_post_id = (SELECT post FROM ids)),
  0, 'scans went with the removed tag');

-- ─── Cascade: deleting the host post ──────────────────────────────────

INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id, host_post_id, tag_x_pct, tag_y_pct)
SELECT ai, 'embedded', bp, post, 30, 30 FROM ids;
INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id, host_post_id, tag_x_pct, tag_y_pct)
SELECT ai, 'embedded', bp, post, 70, 70 FROM ids;

SELECT is(
  (SELECT count(*)::int FROM public.tags WHERE host_post_id = (SELECT post FROM ids)),
  3, 'the post carries three embedded tags');

DELETE FROM public.posts WHERE id = (SELECT post FROM ids);

SELECT is(
  (SELECT count(*)::int FROM public.tags WHERE tag_type = 'embedded' AND owner_profile_id = (SELECT ai FROM ids)),
  0, 'deleting a host post removes its embedded tags');

SELECT * FROM finish();
ROLLBACK;
