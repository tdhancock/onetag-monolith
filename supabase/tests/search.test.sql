-- Search across profiles, posts, products and projects (ONE-48). Runs
-- against a real database:
--
--   pnpm db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- S: the searcher.
-- A: 'one48_builder'. Posts about kitchens; business 'one48_builder_biz'
--    lists the Oak Lamp; owns public project Loft (its description mentions
--    reclaimed timber) and private project Vault.
-- Z: 'one48_zed', full name 'Builders Guild'. A post about kitchens.
-- Q: 'one48_abuilder'. Blocked by S. A post about kitchens.
-- R: 'one48_r'. Blocked S. A post about kitchens.

BEGIN;
SELECT plan(16);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000048a0', 's@one48.test', '{"username":"one48_s"}'),
  ('00000000-0000-0000-0000-0000000048a1', 'a@one48.test', '{"username":"one48_builder"}'),
  ('00000000-0000-0000-0000-0000000048a2', 'z@one48.test', '{"username":"one48_zed"}'),
  ('00000000-0000-0000-0000-0000000048a3', 'q@one48.test', '{"username":"one48_abuilder"}'),
  ('00000000-0000-0000-0000-0000000048a4', 'r@one48.test', '{"username":"one48_r"}');

UPDATE public.profiles SET full_name = 'Builders Guild' WHERE username = 'one48_zed';
INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('00000000-0000-0000-0000-0000000048a1', 'business', 'one48_builder_biz', 'Builder Works');
INSERT INTO public.business_profiles (profile_id) SELECT id FROM public.profiles WHERE username = 'one48_builder_biz';

INSERT INTO public.blocks (blocker_id, blocked_id) VALUES
  ('00000000-0000-0000-0000-0000000048a0', '00000000-0000-0000-0000-0000000048a3'),
  ('00000000-0000-0000-0000-0000000048a4', '00000000-0000-0000-0000-0000000048a0');

INSERT INTO public.posts (id, user_id, content) VALUES
  ('48000000-0000-0000-0000-000000000001', (SELECT id FROM public.profiles WHERE username = 'one48_builder'), 'Kitchen reveal: the kitchen island, the kitchen shelves'),
  ('48000000-0000-0000-0000-000000000002', (SELECT id FROM public.profiles WHERE username = 'one48_zed'), 'A small kitchen shelf'),
  ('48000000-0000-0000-0000-000000000003', (SELECT id FROM public.profiles WHERE username = 'one48_abuilder'), 'Blocked kitchen'),
  ('48000000-0000-0000-0000-000000000004', (SELECT id FROM public.profiles WHERE username = 'one48_r'), 'Blocking kitchen');

INSERT INTO public.products (id, business_profile_id, name, category) VALUES
  ('48000000-0000-0000-0000-0000000000a1', (SELECT id FROM public.profiles WHERE username = 'one48_builder_biz'), 'Oak Lamp', 'Lighting'),
  ('48000000-0000-0000-0000-0000000000a2', (SELECT id FROM public.profiles WHERE username = 'one48_builder_biz'), 'Oak Stool', 'Seating');
INSERT INTO public.projects (id, owner_profile_id, name, description, is_public) VALUES
  ('48000000-0000-0000-0000-0000000000b1', (SELECT id FROM public.profiles WHERE username = 'one48_builder'), 'Loft', 'A loft rebuilt in reclaimed timber', true),
  ('48000000-0000-0000-0000-0000000000b2', (SELECT id FROM public.profiles WHERE username = 'one48_builder'), 'Vault', 'Reclaimed timber, privately', false);

-- ─── As S ─────────────────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000048a0","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(name ORDER BY name) FROM public.search_products('oak lamp')),
  ARRAY['Oak Lamp'], 'a product is found by its name, every word required');

SELECT is(
  (SELECT array_agg(name) FROM public.search_projects('reclaimed timber')),
  ARRAY['Loft'], 'a project is found by words in its description — full text, not the title');

SELECT is(
  (SELECT count(*)::int FROM public.search_projects('vault')), 0,
  'a private project never appears to someone outside it');

SELECT is(
  (SELECT array_agg(username) FROM public.search_profiles('ONE48_BUIL')),
  ARRAY['one48_builder', 'one48_builder_biz'],
  'a partial handle matches whatever its case, handle-prefix matches alphabetically — and never a blocked account');

SELECT is(
  (SELECT array_agg(username) FROM public.search_profiles('builder')),
  ARRAY['one48_builder_biz', 'one48_zed', 'one48_builder'],
  'names starting with the query rank above a handle that merely contains it');

SELECT is(
  (SELECT array_agg(content ORDER BY rank DESC) FROM public.search_posts('kitch')),
  ARRAY['Kitchen reveal: the kitchen island, the kitchen shelves', 'A small kitchen shelf'],
  'a word prefix finds posts, ranked by how well they match — and neither blocked account''s post');

SELECT ok(
  (SELECT bool_and(a.rank >= b.rank) FROM
    (SELECT rank, row_number() OVER () n FROM public.search_posts('kitchen')) a
    JOIN (SELECT rank, row_number() OVER () n FROM public.search_posts('kitchen')) b ON b.n = a.n + 1),
  'posts come back in rank order');

SELECT is((SELECT count(*)::int FROM public.search_posts('zebra')), 0, 'a query matching nothing returns nothing');

SELECT is((SELECT count(*)::int FROM public.search_posts($$'&|!:*()$$)), 0,
  'input that is only tsquery syntax searches for nothing, and does not fail');

SELECT is((SELECT count(*)::int FROM public.search_profiles('%')), 0,
  'an ILIKE wildcard is matched literally, not as "everything"');

SELECT is(
  (SELECT array_agg(name) FROM public.search_products('oak', 'Seating')),
  ARRAY['Oak Stool'], 'a product search narrows to a category');

SELECT is(
  (SELECT array_agg(name) FROM public.search_projects('timber', 'Nope')),
  NULL, 'a project search narrows to a category');

-- ─── As A, who owns the private project ───────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000048a1","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(name ORDER BY name) FROM public.search_projects('reclaimed')),
  ARRAY['Loft', 'Vault'], 'a private project appears to its owner');

SELECT is(
  (SELECT array_agg(name ORDER BY name) FROM public.search_projects('reclaimed', NULL, 30, true)),
  ARRAY['Loft'], 'public-only leaves out even the owner''s private project — the tag picker''s search');

RESET ROLE;

-- ─── The posts search uses its GIN index ──────────────────────────────
--
-- Seq scans are switched off so the tiny fixture table can't make a scan
-- cheaper than the index; what's checked is that the index can serve it.

CREATE FUNCTION pg_temp.plan_of(q TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE line TEXT; out TEXT := '';
BEGIN
  FOR line IN EXECUTE 'EXPLAIN ' || q LOOP out := out || line || E'\n'; END LOOP;
  RETURN out;
END $$;

SET LOCAL enable_seqscan = off;
SELECT ok(
  pg_temp.plan_of($$SELECT id FROM public.posts WHERE search_vector @@ public.search_tsquery('kitchen')$$) LIKE '%posts_search_vector%',
  'the posts search is served by the posts_search_vector GIN index');

SELECT ok(
  (SELECT attgenerated = 's' FROM pg_attribute WHERE attrelid = 'public.posts'::regclass AND attname = 'search_vector'),
  'posts.search_vector is generated, so it can never drift from the content');

SELECT * FROM finish();
ROLLBACK;
