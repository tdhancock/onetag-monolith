-- Saves of posts, products, projects and profiles (ONE-39). Runs against a
-- real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account A: individual AI (signup) and business AB. AB lists product PR; AI
--            owns project PJ and wrote post PO.
-- Account B: individual BI. A stranger to A's saves.

BEGIN;
SELECT plan(21);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000039', 'a@one39.test', '{"username":"one39_a"}'),
  ('bbbbbbbb-0000-0000-0000-000000000039', 'b@one39.test', '{"username":"one39_b"}');

INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000039', 'business', 'one39_a_biz', 'A Studio');
INSERT INTO public.business_profiles (profile_id) SELECT id FROM public.profiles WHERE username = 'one39_a_biz';

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one39_a') AS ai,
  (SELECT id FROM public.profiles WHERE username = 'one39_a_biz') AS ab,
  (SELECT id FROM public.profiles WHERE username = 'one39_b') AS bi,
  'a0000000-0000-0000-0000-000000000039'::uuid AS po,
  'b0000000-0000-0000-0000-000000000039'::uuid AS pr,
  'c0000000-0000-0000-0000-000000000039'::uuid AS pj;
GRANT SELECT ON ids TO authenticated, anon;

INSERT INTO public.posts (id, user_id, content) VALUES ((SELECT po FROM ids), (SELECT ai FROM ids), 'Hello');
INSERT INTO public.products (id, business_profile_id, name) VALUES ((SELECT pr FROM ids), (SELECT ab FROM ids), 'Lamp');
INSERT INTO public.projects (id, owner_profile_id, name) VALUES ((SELECT pj FROM ids), (SELECT ai FROM ids), 'Loft');

-- ─── 1. Saving, as account A ──────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000039","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.saves (profile_id, saved_post_id) VALUES ((SELECT ai FROM ids), (SELECT po FROM ids))$$,
  'a profile saves a post');
SELECT lives_ok(
  $$INSERT INTO public.saves (profile_id, saved_product_id) VALUES ((SELECT ai FROM ids), (SELECT pr FROM ids))$$,
  'a product');
SELECT lives_ok(
  $$INSERT INTO public.saves (profile_id, saved_project_id) VALUES ((SELECT ai FROM ids), (SELECT pj FROM ids))$$,
  'a project');
SELECT lives_ok(
  $$INSERT INTO public.saves (profile_id, saved_profile_id) VALUES ((SELECT ai FROM ids), (SELECT bi FROM ids))$$,
  'and a profile');

SELECT throws_ok(
  $$INSERT INTO public.saves (profile_id, saved_post_id) VALUES ((SELECT ai FROM ids), (SELECT po FROM ids))$$,
  '23505', NULL, 'a post already saved by a profile cannot be saved again');
SELECT throws_ok(
  $$INSERT INTO public.saves (profile_id, saved_product_id) VALUES ((SELECT ai FROM ids), (SELECT pr FROM ids))$$,
  '23505', NULL, 'nor a product');

SELECT lives_ok(
  $$INSERT INTO public.saves (profile_id, saved_post_id) VALUES ((SELECT ab FROM ids), (SELECT po FROM ids))$$,
  'the account''s other profile saves the same post: saves belong to a profile');

SELECT throws_ok(
  $$INSERT INTO public.saves (profile_id) VALUES ((SELECT ai FROM ids))$$,
  '23514', NULL, 'the check rejects a save with no target');
SELECT throws_ok(
  $$INSERT INTO public.saves (profile_id, saved_post_id, saved_product_id) VALUES ((SELECT ai FROM ids), (SELECT po FROM ids), (SELECT pr FROM ids))$$,
  '23514', NULL, 'the check rejects a save with two targets');

SELECT throws_ok(
  $$INSERT INTO public.saves (profile_id, saved_post_id) VALUES ((SELECT bi FROM ids), (SELECT po FROM ids))$$,
  '42501', NULL, 'nobody saves as a profile they do not own');

SELECT is((SELECT count(*)::int FROM public.saves WHERE profile_id = (SELECT ai FROM ids)), 4,
  'each profile''s saves are its own: four for AI');
SELECT is((SELECT count(*)::int FROM public.saves WHERE profile_id = (SELECT ab FROM ids)), 1,
  'and one for AB');

WITH u AS (UPDATE public.saves SET saved_at = now() WHERE profile_id = (SELECT ai FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 0, 'a save has nothing to edit: no update policy');

-- ─── 2. Another account (B) ───────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000039","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.saves WHERE profile_id IN ((SELECT ai FROM ids), (SELECT ab FROM ids))), 0,
  'another account cannot read a profile''s saves');

WITH d AS (DELETE FROM public.saves WHERE profile_id = (SELECT ai FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM d), 0, 'nor delete them');

-- ─── 3. Anonymous ─────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is((SELECT count(*)::int FROM public.saves), 0, 'an anonymous client reads no saves');

-- ─── 4. Unsaving, and the cascades ────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000039","role":"authenticated"}', true);

WITH d AS (DELETE FROM public.saves WHERE profile_id = (SELECT ai FROM ids) AND saved_profile_id IS NOT NULL RETURNING 1)
SELECT is((SELECT count(*)::int FROM d), 1, 'a profile unsaves');

RESET ROLE;

DELETE FROM public.products WHERE id = (SELECT pr FROM ids);
SELECT is((SELECT count(*)::int FROM public.saves WHERE saved_product_id = (SELECT pr FROM ids)), 0,
  'deleting a saved product removes the save');

DELETE FROM public.posts WHERE id = (SELECT po FROM ids);
SELECT is((SELECT count(*)::int FROM public.saves WHERE saved_post_id = (SELECT po FROM ids)), 0,
  'deleting a saved post removes every save of it');

SELECT hasnt_table('public', 'saved_posts', 'saved_posts is gone, its rows moved to saves');

SELECT has_index('public', 'saves', 'saves_profile_id_saved_at', 'a profile''s saves are indexed newest first');

SELECT * FROM finish();
ROLLBACK;
