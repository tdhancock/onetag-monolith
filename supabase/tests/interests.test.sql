-- Interest categories (ONE-49). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- V: the viewer. A: posts CAR (vehicle-builds), HOME (custom-homes) and
-- PLAIN (no interest); public project SHED (diy-projects); product LAMP.

BEGIN;
SELECT plan(13);

SELECT is(
  (SELECT array_agg(slug ORDER BY sort_order) FROM public.interests),
  ARRAY['vehicle-builds', 'custom-homes', 'fitness-and-gear', 'art-and-installations', 'diy-projects', 'retail-displays'],
  'the six categories are seeded, in order');

SELECT is((SELECT count(*)::int FROM public.posts WHERE interest_slug IS NOT NULL), 0,
  'no existing post was given an interest');
SELECT is((SELECT count(*)::int FROM public.projects WHERE interest_slug IS NOT NULL), 0,
  'no existing project was given an interest');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000049a0', 'v@one49.test', '{"username":"one49_v"}'),
  ('00000000-0000-0000-0000-0000000049a1', 'a@one49.test', '{"username":"one49_a"}');
INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('00000000-0000-0000-0000-0000000049a1', 'business', 'one49_a_biz', 'A Works');
INSERT INTO public.business_profiles (profile_id) SELECT id FROM public.profiles WHERE username = 'one49_a_biz';

INSERT INTO public.posts (id, user_id, content, interest_slug) VALUES
  ('49000000-0000-0000-0000-000000000001', (SELECT id FROM public.profiles WHERE username = 'one49_a'), 'car', 'vehicle-builds'),
  ('49000000-0000-0000-0000-000000000002', (SELECT id FROM public.profiles WHERE username = 'one49_a'), 'home', 'custom-homes'),
  ('49000000-0000-0000-0000-000000000003', (SELECT id FROM public.profiles WHERE username = 'one49_a'), 'plain', NULL);
INSERT INTO public.projects (id, owner_profile_id, name, is_public, interest_slug) VALUES
  ('49000000-0000-0000-0000-0000000000b1', (SELECT id FROM public.profiles WHERE username = 'one49_a'), 'Shed', true, 'diy-projects');
INSERT INTO public.products (id, business_profile_id, name) VALUES
  ('49000000-0000-0000-0000-0000000000a1', (SELECT id FROM public.profiles WHERE username = 'one49_a_biz'), 'Lamp');

SELECT throws_ok(
  $$INSERT INTO public.posts (user_id, content, interest_slug)
    SELECT id, 'x', 'car-builds' FROM public.profiles WHERE username = 'one49_a'$$,
  '23503', NULL, 'an interest not in the list is refused — no free text');

-- ─── The list is written by migrations only ───────────────────────────

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is((SELECT count(*)::int FROM public.interests), 6, 'anyone can read the list');
SELECT throws_ok($$INSERT INTO public.interests (slug, name) VALUES ('spam', 'Spam')$$,
  '42501', NULL, 'an anonymous client cannot add an interest');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000049a0","role":"authenticated"}', true);

SELECT throws_ok($$INSERT INTO public.interests (slug, name) VALUES ('spam', 'Spam')$$,
  '42501', NULL, 'a signed-in client cannot add an interest either');

UPDATE public.interests SET name = 'Hacked' WHERE slug = 'diy-projects';
SELECT is((SELECT name FROM public.interests WHERE slug = 'diy-projects'), 'DIY Projects',
  'nor rename one');

-- ─── Explore, filtered in the query ───────────────────────────────────

CREATE TEMP TABLE grid ON COMMIT DROP AS
  SELECT i.* FROM public.explore_items(NULL, NULL, 60, NULL) i
  WHERE owner_username LIKE 'one49_%';
CREATE TEMP TABLE cars ON COMMIT DROP AS
  SELECT i.* FROM public.explore_items(NULL, NULL, 60, 'vehicle-builds') i;
CREATE TEMP TABLE diy ON COMMIT DROP AS
  SELECT i.* FROM public.explore_items(NULL, NULL, 60, 'diy-projects') i;

SELECT is((SELECT array_agg(title ORDER BY title COLLATE "C") FROM grid),
  ARRAY['Lamp', 'Shed', 'car', 'home', 'plain'], 'All shows everything, untagged included');
SELECT is((SELECT array_agg(title) FROM cars), ARRAY['car'],
  'a filter shows only its interest''s posts: not another interest, not untagged, not products');
SELECT is((SELECT array_agg(title) FROM diy), ARRAY['Shed'], 'a filter reaches projects too');
SELECT is((SELECT count(*)::int FROM public.explore_items(NULL, NULL, 60, 'retail-displays')), 0,
  'an interest with nothing in it returns nothing');

RESET ROLE;
SELECT ok(
  (SELECT count(*) = 2 FROM pg_indexes WHERE indexname IN ('posts_interest_slug_created_at', 'projects_interest_slug_created_at')),
  'posts and projects are indexed by interest, newest first');

SELECT * FROM finish();
ROLLBACK;
