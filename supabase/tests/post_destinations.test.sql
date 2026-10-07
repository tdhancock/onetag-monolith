-- A Tag can point to a post (decided 2026-09-28). Runs against a real
-- database:
--
--   pnpm db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- A posts PA and PA2. B posts PB. P is private and posts PP. X is blocked
-- by A.

BEGIN;
SELECT plan(19);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000d05a0', 'a@postdest.test', '{"username":"postdest_a"}'),
  ('00000000-0000-0000-0000-0000000d05a1', 'b@postdest.test', '{"username":"postdest_b"}'),
  ('00000000-0000-0000-0000-0000000d05a2', 'p@postdest.test', '{"username":"postdest_p"}'),
  ('00000000-0000-0000-0000-0000000d05a3', 'x@postdest.test', '{"username":"postdest_x"}');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'postdest_a') AS a,
  (SELECT id FROM public.profiles WHERE username = 'postdest_b') AS b,
  (SELECT id FROM public.profiles WHERE username = 'postdest_p') AS p,
  (SELECT id FROM public.profiles WHERE username = 'postdest_x') AS x,
  'd0500000-0000-0000-0000-000000000001'::uuid AS pa,
  'd0500000-0000-0000-0000-000000000002'::uuid AS pa2,
  'd0500000-0000-0000-0000-000000000003'::uuid AS pb,
  'd0500000-0000-0000-0000-000000000004'::uuid AS pp;
GRANT SELECT ON ids TO authenticated, anon;

UPDATE public.profiles SET is_private = true WHERE username = 'postdest_p';
INSERT INTO public.posts (id, user_id, content, image_url, media_type)
SELECT pa, a, 'the new kitchen', 'https://example.test/k.jpg', 'image' FROM ids
UNION ALL SELECT pa2, a, 'another', NULL, 'text' FROM ids
UNION ALL SELECT pb, b, 'my photo', 'https://example.test/b.jpg', 'image' FROM ids
UNION ALL SELECT pp, p, 'private thoughts', NULL, 'text' FROM ids;
INSERT INTO public.blocks (blocker_id, blocked_id) VALUES
  ('00000000-0000-0000-0000-0000000d05a0', '00000000-0000-0000-0000-0000000d05a3');

SELECT has_column('public', 'tags', 'dest_post_id', 'a tag can name a post as its destination');

-- ─── Physical and Digital: your own posts ─────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000d05a0","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.tags (id, owner_profile_id, tag_type, dest_post_id, short_code)
    SELECT 'd0500000-0000-0000-0000-0000000000a1', a, 'digital', pa, 'PostTg23' FROM ids$$,
  'you can make a Digital Tag for a post of yours');
SELECT lives_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, format, dest_post_id, short_code)
    SELECT a, 'physical', 'qr', pa, 'PostQr23' FROM ids$$,
  'and a Physical one');
SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_post_id) SELECT a, 'digital', pb FROM ids$$,
  '42501', NULL, 'but not for someone else''s post');
SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_post_id, dest_profile_id) SELECT a, 'digital', pa, a FROM ids$$,
  '23514', NULL, 'a tag still has exactly one destination');
SELECT throws_ok(
  $$UPDATE public.tags SET dest_post_id = (SELECT pa2 FROM ids) WHERE short_code = 'PostTg23'$$,
  '42501', NULL, 'and never points somewhere else afterwards');

-- ─── Resolution, as a stranger with no account ────────────────────────

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  (SELECT row(dest_post_id, dest_post_username, dest_profile_id)::text FROM public.resolve_tag('PostTg23')),
  (SELECT row(pa, 'postdest_a'::text, NULL::uuid)::text FROM ids),
  'a post tag resolves to its post and its author''s handle, signed out');
RESET ROLE;

-- ─── Embedded: any post the author can see ────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000d05a1","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.tags (id, owner_profile_id, tag_type, host_post_id, tag_x_pct, tag_y_pct, dest_post_id)
    SELECT 'd0500000-0000-0000-0000-0000000000b1', b, 'embedded', pb, 50, 50, pa FROM ids$$,
  'a photo can carry a tag pointing at someone else''s post');
SELECT is(
  (SELECT count(*)::int FROM public.tags WHERE host_post_id = (SELECT pb FROM ids) AND dest_post_id = (SELECT pa FROM ids)),
  1, 'which anyone who can see the photo reads');
SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, host_post_id, tag_x_pct, tag_y_pct, dest_post_id)
    SELECT b, 'embedded', pb, 10, 10, pb FROM ids$$,
  '42501', NULL, 'never at the photo''s own post');
SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, host_post_id, tag_x_pct, tag_y_pct, dest_post_id)
    SELECT b, 'embedded', pb, 10, 10, pp FROM ids$$,
  '42501', NULL, 'nor at a post its author can''t see, a private account''s they don''t follow');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000d05a3","role":"authenticated"}', true);
INSERT INTO public.posts (id, user_id, content) SELECT 'd0500000-0000-0000-0000-000000000005', x, 'mine' FROM ids;
SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, host_post_id, tag_x_pct, tag_y_pct, dest_post_id)
    SELECT x, 'embedded', 'd0500000-0000-0000-0000-000000000005', 10, 10, pa FROM ids$$,
  '42501', NULL, 'nor at a post across a block');

-- The post's author takes the tag off B's photo.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000d05a0","role":"authenticated"}', true);
DELETE FROM public.tags WHERE id = 'd0500000-0000-0000-0000-0000000000b1';
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.tags WHERE id = 'd0500000-0000-0000-0000-0000000000b1'),
  0, 'a post''s author can take a tag pointing at it off someone else''s photo');

-- ─── Scan history ─────────────────────────────────────────────────────

INSERT INTO public.scans (tag_id, scanner_profile_id) SELECT 'd0500000-0000-0000-0000-0000000000a1', b FROM ids;
UPDATE public.profiles SET scan_history_public = true WHERE username = 'postdest_b';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000d05a1","role":"authenticated"}', true);
SELECT is(
  (SELECT row(dest_kind, dest_id, dest_name, dest_username)::text FROM public.scan_history((SELECT b FROM ids))),
  (SELECT row('post'::text, pa, 'Post by @postdest_a'::text, 'postdest_a'::text)::text FROM ids),
  'a scanned post is in the history, named by its author');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000d05a2","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.scan_history((SELECT b FROM ids)) WHERE dest_name LIKE '%kitchen%'),
  0, 'and never by its text, when the history is public');
RESET ROLE;

-- ─── Deleting the post ────────────────────────────────────────────────

DELETE FROM public.posts WHERE id = (SELECT pa FROM ids);
SELECT is(
  (SELECT count(*)::int FROM public.tags WHERE dest_post_id = (SELECT pa FROM ids)),
  0, 'deleting a post deletes the tags pointing at it');
SELECT is(
  (SELECT count(*)::int FROM public.resolve_tag('PostTg23')),
  0, 'so its code no longer resolves');

-- ─── Who may call ─────────────────────────────────────────────────────

SELECT ok(
  has_function_privilege('anon', 'public.resolve_tag(text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.resolve_tag(text)', 'EXECUTE'),
  'anyone may still resolve a tag');
SELECT ok(
  has_function_privilege('authenticated', 'public.scan_history(uuid)', 'EXECUTE'),
  'and read a scan history');

SELECT * FROM finish();
ROLLBACK;
