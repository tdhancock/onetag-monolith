-- explore_items: the Explore grid (ONE-47). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- V: the viewer. Owns post MINE.
-- A: individual. Post TAGGED (two embedded tags), post OLD (a day old, three
--    likes) and post NEW (just now, no engagement).
-- B: business. Product LAMP; public project LOFT; private project VAULT.
-- P: private individual. Post SECRET.
-- X: blocked V. Post FROMX.
-- Y: V blocked Y. Post FROMY.

BEGIN;
SELECT plan(12);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000047a0', 'v@one47.test', '{"username":"one47_v"}'),
  ('00000000-0000-0000-0000-0000000047a1', 'a@one47.test', '{"username":"one47_a"}'),
  ('00000000-0000-0000-0000-0000000047a2', 'b@one47.test', '{"username":"one47_b"}'),
  ('00000000-0000-0000-0000-0000000047a3', 'p@one47.test', '{"username":"one47_p"}'),
  ('00000000-0000-0000-0000-0000000047a4', 'x@one47.test', '{"username":"one47_x"}'),
  ('00000000-0000-0000-0000-0000000047a5', 'y@one47.test', '{"username":"one47_y"}');

INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('00000000-0000-0000-0000-0000000047a2', 'business', 'one47_b_biz', 'B Works');
INSERT INTO public.business_profiles (profile_id) SELECT id FROM public.profiles WHERE username = 'one47_b_biz';
UPDATE public.profiles SET is_private = true WHERE username = 'one47_p';

INSERT INTO public.blocks (blocker_id, blocked_id) VALUES
  ('00000000-0000-0000-0000-0000000047a4', '00000000-0000-0000-0000-0000000047a0'),
  ('00000000-0000-0000-0000-0000000047a0', '00000000-0000-0000-0000-0000000047a5');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one47_v') AS v,
  (SELECT id FROM public.profiles WHERE username = 'one47_a') AS a,
  (SELECT id FROM public.profiles WHERE username = 'one47_b') AS bi,
  (SELECT id FROM public.profiles WHERE username = 'one47_b_biz') AS bb,
  (SELECT id FROM public.profiles WHERE username = 'one47_p') AS p,
  (SELECT id FROM public.profiles WHERE username = 'one47_x') AS x,
  (SELECT id FROM public.profiles WHERE username = 'one47_y') AS y;
GRANT SELECT ON ids TO authenticated;

INSERT INTO public.posts (id, user_id, content, image_url, media_type, created_at) VALUES
  ('47000000-0000-0000-0000-000000000001', (SELECT v FROM ids), 'mine', 'm.jpg', 'image', now()),
  ('47000000-0000-0000-0000-000000000002', (SELECT a FROM ids), 'tagged', 't.jpg', 'image', now() - interval '2 hours'),
  ('47000000-0000-0000-0000-000000000003', (SELECT a FROM ids), 'old', 'o.jpg', 'image', now() - interval '1 day'),
  ('47000000-0000-0000-0000-000000000004', (SELECT a FROM ids), 'new', 'n.jpg', 'image', now()),
  ('47000000-0000-0000-0000-000000000005', (SELECT p FROM ids), 'secret', 's.jpg', 'image', now()),
  ('47000000-0000-0000-0000-000000000006', (SELECT x FROM ids), 'fromx', 'x.jpg', 'image', now()),
  ('47000000-0000-0000-0000-000000000007', (SELECT y FROM ids), 'fromy', 'y.jpg', 'image', now());

INSERT INTO public.products (id, business_profile_id, name) VALUES
  ('47000000-0000-0000-0000-0000000000a1', (SELECT bb FROM ids), 'Lamp');
INSERT INTO public.projects (id, owner_profile_id, name, is_public) VALUES
  ('47000000-0000-0000-0000-0000000000b1', (SELECT bb FROM ids), 'Loft', true),
  ('47000000-0000-0000-0000-0000000000b2', (SELECT bb FROM ids), 'Vault', false);

-- Two embedded tags on TAGGED, one paused tag that doesn't count.
INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id, host_post_id, tag_x_pct, tag_y_pct, active)
SELECT a, 'embedded', '47000000-0000-0000-0000-0000000000a1', '47000000-0000-0000-0000-000000000002', pos, pos, act
FROM ids, (VALUES (10, true), (20, true), (30, false)) AS v(pos, act);

-- Three likes on OLD: 24 × log2(4) = 48 hours of lift, over a one-day head start for NEW.
INSERT INTO public.likes (post_id, user_id)
SELECT '47000000-0000-0000-0000-000000000003', liker FROM ids, unnest(ARRAY[ids.bi, ids.bb, ids.v]) AS liker;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000047a0","role":"authenticated"}', true);

CREATE TEMP TABLE grid ON COMMIT DROP AS SELECT * FROM public.explore_items(NULL, NULL, 60);

SELECT is(
  (SELECT array_agg(DISTINCT kind ORDER BY kind) FROM grid WHERE owner_username LIKE 'one47_%'),
  ARRAY['post', 'product', 'project'],
  'the grid mixes posts, products and projects');

SELECT is((SELECT count(*)::int FROM grid WHERE id = '47000000-0000-0000-0000-000000000001'), 0,
  'the viewer''s own post never appears');
SELECT is((SELECT count(*)::int FROM grid WHERE id = '47000000-0000-0000-0000-0000000000b2'), 0,
  'a private project never appears');
SELECT is((SELECT count(*)::int FROM grid WHERE id = '47000000-0000-0000-0000-000000000005'), 0,
  'a private profile''s post never appears');
SELECT is((SELECT count(*)::int FROM grid WHERE id = '47000000-0000-0000-0000-000000000006'), 0,
  'content from an account that blocked the viewer never appears');
SELECT is((SELECT count(*)::int FROM grid WHERE id = '47000000-0000-0000-0000-000000000007'), 0,
  'content from an account the viewer blocked never appears');

SELECT is((SELECT tag_count FROM grid WHERE id = '47000000-0000-0000-0000-000000000002'), 2,
  'a post carries its count of live embedded tags');
SELECT is((SELECT owner_username FROM grid WHERE id = '47000000-0000-0000-0000-0000000000a1'), 'one47_b_biz',
  'a product is attributed to the business that lists it');

SELECT ok(
  (SELECT score FROM grid WHERE id = '47000000-0000-0000-0000-000000000003')
    > (SELECT score FROM grid WHERE id = '47000000-0000-0000-0000-000000000004'),
  'three likes lift a day-old post above an unengaged new one: each doubling is worth a day');

SELECT ok(
  (SELECT bool_and(a.score >= b.score) FROM
    (SELECT score, row_number() OVER () AS n FROM grid) a
    JOIN (SELECT score, row_number() OVER () AS n FROM grid) b ON b.n = a.n + 1),
  'the grid comes back in score order');

-- Paging: two pages of two, keyed on the last row, cover the first four
-- rows exactly, with no repeats.
CREATE TEMP TABLE page1 ON COMMIT DROP AS SELECT * FROM public.explore_items(NULL, NULL, 2);
CREATE TEMP TABLE page2 ON COMMIT DROP AS
  SELECT * FROM public.explore_items(
    (SELECT score FROM page1 ORDER BY score ASC, item_key ASC LIMIT 1),
    (SELECT item_key FROM page1 ORDER BY score ASC, item_key ASC LIMIT 1),
    2);

SELECT is(
  (SELECT array_agg(item_key ORDER BY score DESC, item_key DESC) FROM (SELECT * FROM page1 UNION ALL SELECT * FROM page2) pages),
  (SELECT array_agg(item_key) FROM (SELECT item_key FROM grid ORDER BY score DESC, item_key DESC LIMIT 4) first4),
  'the next page picks up exactly after the last row, with no repeats');

RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.explore_items(double precision, text, integer, text)', 'EXECUTE'),
  'Explore is signed in only');

SELECT * FROM finish();
ROLLBACK;
