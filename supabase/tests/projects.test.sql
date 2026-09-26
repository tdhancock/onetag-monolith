-- Projects, Contributors, project products, and tags pointing at products
-- and projects (ONE-38). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account A: individual AI (signup). Owns public project PUB and private
--            project PRIV — projects are not business-only.
-- Account B: business BB. Lists product BP.
-- Account C: individual CI. Linked to A's projects as a Contributor.
-- Account D: individual DI. A stranger to all of it.

BEGIN;
SELECT plan(33);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000038', 'a@one38.test', '{"username":"one38_a"}'),
  ('bbbbbbbb-0000-0000-0000-000000000038', 'b@one38.test', '{"username":"one38_b"}'),
  ('cccccccc-0000-0000-0000-000000000038', 'c@one38.test', '{"username":"one38_c"}'),
  ('dddddddd-0000-0000-0000-000000000038', 'd@one38.test', '{"username":"one38_d"}');

INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('bbbbbbbb-0000-0000-0000-000000000038', 'business', 'one38_b_biz', 'B Works');
INSERT INTO public.business_profiles (profile_id, category)
SELECT id, 'Hardware' FROM public.profiles WHERE username = 'one38_b_biz';

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one38_a') AS ai,
  (SELECT id FROM public.profiles WHERE username = 'one38_b_biz') AS bb,
  (SELECT id FROM public.profiles WHERE username = 'one38_c') AS ci,
  (SELECT id FROM public.profiles WHERE username = 'one38_d') AS di,
  'f0000000-0000-0000-0000-000000000001'::uuid AS pub,
  'f0000000-0000-0000-0000-000000000002'::uuid AS priv,
  'f0000000-0000-0000-0000-000000000003'::uuid AS bp,
  'f0000000-0000-0000-0000-000000000004'::uuid AS tag;
GRANT SELECT ON ids TO authenticated, anon;

INSERT INTO public.products (id, business_profile_id, name)
VALUES ((SELECT bp FROM ids), (SELECT bb FROM ids), 'B hinge');

-- ─── 1. Projects and links, as the owner (A) ──────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000038","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.projects (id, owner_profile_id, name, project_type, year)
    VALUES ((SELECT pub FROM ids), (SELECT ai FROM ids), 'Kitchen rebuild', 'Renovation', '2026')$$,
  'an individual profile creates a project — projects are not business-only');

SELECT lives_ok(
  $$INSERT INTO public.projects (id, owner_profile_id, name, is_public)
    VALUES ((SELECT priv FROM ids), (SELECT ai FROM ids), 'Secret shed', false)$$,
  'the owner creates a private project');

SELECT lives_ok(
  $$INSERT INTO public.contributors (project_id, contributor_profile_id, role)
    VALUES ((SELECT priv FROM ids), (SELECT ci FROM ids), 'Carpenter')$$,
  'the project owner links a contributor');

SELECT throws_ok(
  $$INSERT INTO public.contributors (project_id, contributor_profile_id)
    VALUES ((SELECT priv FROM ids), (SELECT ci FROM ids))$$,
  '23505', NULL, 'a profile is linked to a project once');

SELECT lives_ok(
  $$INSERT INTO public.contributors (project_id, contributor_profile_id, is_public)
    VALUES ((SELECT pub FROM ids), (SELECT ci FROM ids), false)$$,
  'the owner links a hidden contributor to the public project');

SELECT lives_ok(
  $$INSERT INTO public.project_products (project_id, product_id) VALUES ((SELECT pub FROM ids), (SELECT bp FROM ids))$$,
  'a project links a product another business lists');

SELECT lives_ok(
  $$INSERT INTO public.project_products (project_id, product_id) VALUES ((SELECT priv FROM ids), (SELECT bp FROM ids))$$,
  'and the private project links it too');

-- ─── 2. Tags pointing at products and projects, as A ──────────────────

SELECT lives_ok(
  $$INSERT INTO public.tags (id, owner_profile_id, tag_type, format, dest_project_id)
    VALUES ((SELECT tag FROM ids), (SELECT ai FROM ids), 'physical', 'qr', (SELECT pub FROM ids))$$,
  'the owner tags their own project');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_profile_id, dest_project_id)
    VALUES ((SELECT ai FROM ids), 'digital', (SELECT ai FROM ids), (SELECT pub FROM ids))$$,
  '23514', NULL, 'the destination check rejects two destinations');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type) VALUES ((SELECT ai FROM ids), 'digital')$$,
  '23514', NULL, 'the destination check still rejects zero destinations');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id)
    VALUES ((SELECT ai FROM ids), 'digital', (SELECT bp FROM ids))$$,
  '42501', NULL, 'a user cannot create a tag pointing at another account''s product');

SELECT throws_ok(
  $$UPDATE public.tags SET dest_project_id = NULL, dest_product_id = (SELECT bp FROM ids) WHERE id = (SELECT tag FROM ids)$$,
  '42501', NULL, 'a tag cannot be re-pointed at another account''s product');

-- ─── 3. A stranger (D) ────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000038","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.projects WHERE id = (SELECT priv FROM ids)), 0,
  'an unrelated account cannot see a private project');
SELECT is((SELECT count(*)::int FROM public.projects WHERE id = (SELECT pub FROM ids)), 1,
  'but sees a public one');
SELECT is((SELECT count(*)::int FROM public.contributors WHERE project_id = (SELECT pub FROM ids)), 0,
  'a hidden contributor link is invisible to a stranger');
SELECT is((SELECT count(*)::int FROM public.contributors WHERE project_id = (SELECT priv FROM ids)), 0,
  'and so is every link on a project the stranger cannot see');
SELECT is((SELECT count(*)::int FROM public.project_products WHERE project_id = (SELECT pub FROM ids)), 1,
  'a public project''s products are visible to a stranger');
SELECT is((SELECT count(*)::int FROM public.project_products WHERE project_id = (SELECT priv FROM ids)), 0,
  'a private project''s products are not');

SELECT throws_ok(
  $$INSERT INTO public.contributors (project_id, contributor_profile_id) VALUES ((SELECT pub FROM ids), (SELECT di FROM ids))$$,
  '42501', NULL, 'an unrelated account cannot link a contributor');

WITH u AS (UPDATE public.projects SET name = 'hijacked' WHERE id = (SELECT pub FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 0, 'an unrelated account cannot update the project');

-- ─── 4. The contributor (C) ───────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000038","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.projects WHERE id = (SELECT priv FROM ids)), 1,
  'a contributor sees the private project they are linked to');
SELECT is((SELECT count(*)::int FROM public.contributors WHERE project_id = (SELECT pub FROM ids)), 1,
  'a contributor sees their own hidden link');

SELECT throws_ok(
  $$INSERT INTO public.contributors (project_id, contributor_profile_id) VALUES ((SELECT priv FROM ids), (SELECT di FROM ids))$$,
  '42501', NULL, 'a contributor cannot link anyone else');

WITH d AS (
  DELETE FROM public.contributors
  WHERE project_id = (SELECT priv FROM ids) AND contributor_profile_id = (SELECT ci FROM ids) RETURNING 1
)
SELECT is((SELECT count(*)::int FROM d), 1, 'a contributor removes themselves');

SELECT is((SELECT count(*)::int FROM public.projects WHERE id = (SELECT priv FROM ids)), 0,
  'and, unlinked, no longer sees the private project');

-- ─── 5. Anonymous ─────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is((SELECT count(*)::int FROM public.projects WHERE id IN ((SELECT pub FROM ids), (SELECT priv FROM ids))), 1,
  'an anonymous client sees the public project and not the private one');
SELECT is((SELECT count(*)::int FROM public.contributors), 0,
  'an anonymous client sees no hidden contributor link');

SELECT throws_ok(
  $$INSERT INTO public.projects (owner_profile_id, name) VALUES ((SELECT ai FROM ids), 'Anon')$$,
  '42501', NULL, 'an anonymous client cannot create a project');

-- ─── 6. Unlinking, and the cascade ────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000038","role":"authenticated"}', true);

WITH d AS (
  DELETE FROM public.contributors WHERE project_id = (SELECT pub FROM ids) AND contributor_profile_id = (SELECT ci FROM ids) RETURNING 1
)
SELECT is((SELECT count(*)::int FROM d), 1, 'the project owner unlinks a contributor');

INSERT INTO public.contributors (project_id, contributor_profile_id) VALUES ((SELECT pub FROM ids), (SELECT ci FROM ids));

WITH d AS (DELETE FROM public.projects WHERE id = (SELECT pub FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM d), 1, 'the owner deletes a project');

RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.contributors WHERE project_id = (SELECT pub FROM ids)), 0,
  'deleting a project removes its contributor links');
SELECT is((SELECT count(*)::int FROM public.project_products WHERE project_id = (SELECT pub FROM ids)), 0,
  'and its product links');
SELECT is((SELECT count(*)::int FROM public.tags WHERE id = (SELECT tag FROM ids)), 0,
  'and any tag pointing at it');

SELECT * FROM finish();
ROLLBACK;
