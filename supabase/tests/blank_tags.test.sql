-- Blank Physical Tags: a destination set once, after printing (ONE-135).
-- Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account A: individual profile AI (signup trigger), owning projects PJ and
-- PJ2. Account B: individual BI, and business BB listing product BP. Blank
-- Physical Tags BLANK234, BLANK345 and BLANK456 and paused PAUSED23 belong
-- to AI and point nowhere.

BEGIN;
SELECT plan(22);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000135', 'a@one135.test', '{"username":"one135_a"}'),
  ('bbbbbbbb-0000-0000-0000-000000000135', 'b@one135.test', '{"username":"one135_b"}');

INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('bbbbbbbb-0000-0000-0000-000000000135', 'business', 'one135_b_shop', 'B Shop');
INSERT INTO public.business_profiles (profile_id) SELECT id FROM public.profiles WHERE username = 'one135_b_shop';

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one135_a') AS ai,
  (SELECT id FROM public.profiles WHERE username = 'one135_b') AS bi,
  (SELECT id FROM public.profiles WHERE username = 'one135_b_shop') AS bb,
  'cccccccc-0000-0000-0000-0000000001a1'::uuid AS pj,
  'cccccccc-0000-0000-0000-0000000001a2'::uuid AS pj2,
  'cccccccc-0000-0000-0000-0000000001b1'::uuid AS bp,
  'cccccccc-0000-0000-0000-0000000001c1'::uuid AS post;
GRANT SELECT ON ids TO authenticated, anon;

INSERT INTO public.projects (id, owner_profile_id, name) VALUES
  ((SELECT pj FROM ids), (SELECT ai FROM ids), 'Furnace'),
  ((SELECT pj2 FROM ids), (SELECT ai FROM ids), 'Water heater');
INSERT INTO public.products (id, business_profile_id, name)
VALUES ((SELECT bp FROM ids), (SELECT bb FROM ids), 'Filter');
INSERT INTO public.posts (id, user_id, image_url, media_type)
SELECT post, ai, 'https://example.test/furnace.jpg', 'image' FROM ids;

INSERT INTO public.tags (owner_profile_id, tag_type, format, short_code) VALUES
  ((SELECT ai FROM ids), 'physical', 'qr', 'BLANK345'),
  ((SELECT ai FROM ids), 'physical', 'qr', 'BLANK456');
INSERT INTO public.tags (owner_profile_id, tag_type, format, short_code, active)
VALUES ((SELECT ai FROM ids), 'physical', 'qr', 'PAUSED23', false);

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, host_post_id, tag_x_pct, tag_y_pct)
    VALUES ((SELECT ai FROM ids), 'embedded', (SELECT post FROM ids), 50, 50)$$,
  '23514', 'new row for relation "tags" violates check constraint "tags_one_destination"',
  'an Embedded Tag can''t be blank, even written by the database owner');

-- ─── As account A, the owner ──────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000135","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, format, short_code)
    VALUES ((SELECT ai FROM ids), 'physical', 'qr', 'BLANK234')$$,
  'an account can create a Physical Tag with no destination');

SELECT is(
  (SELECT count(*)::int FROM public.tags WHERE short_code = 'BLANK234'
     AND num_nonnulls(dest_profile_id, dest_product_id, dest_project_id, dest_post_id) = 0),
  1, 'the blank tag exists, pointing nowhere');

SELECT lives_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, format) VALUES ((SELECT ai FROM ids), 'physical', 'qr')$$,
  'a blank tag gets a generated short code like any other');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type) VALUES ((SELECT ai FROM ids), 'digital')$$,
  '23514', 'new row for relation "tags" violates check constraint "tags_one_destination"',
  'a Digital Tag can''t be blank: it is shared from its destination');

WITH u AS (
  UPDATE public.tags SET dest_project_id = (SELECT pj FROM ids), name = 'Furnace'
  WHERE short_code = 'BLANK234' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM u), 1, 'the owner links a blank tag to a project the account owns');

SELECT throws_ok(
  $$UPDATE public.tags SET dest_project_id = (SELECT pj2 FROM ids) WHERE short_code = 'BLANK234'$$,
  '42501', NULL, 'once linked, the tag can''t be repointed at another of the account''s projects');

SELECT throws_ok(
  $$UPDATE public.tags SET dest_project_id = NULL WHERE short_code = 'BLANK234'$$,
  '42501', NULL, 'nor unlinked back to blank');

SELECT throws_ok(
  $$UPDATE public.tags SET dest_project_id = (SELECT pj FROM ids), dest_profile_id = (SELECT ai FROM ids)
    WHERE short_code = 'BLANK345'$$,
  '42501', NULL, 'a blank tag can''t be linked to two destinations at once');

SELECT throws_ok(
  $$UPDATE public.tags SET dest_product_id = (SELECT bp FROM ids) WHERE short_code = 'BLANK345'$$,
  '42501', NULL, 'a blank tag can''t be linked to a product another account lists');

WITH u AS (UPDATE public.tags SET name = 'Spare' WHERE short_code = 'BLANK345' RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 1, 'a blank tag can still be named before it is linked');

SELECT is(
  (SELECT row(tag_id IS NOT NULL, active, linked, owned_by_caller)::text FROM public.resolve_tag('BLANK345')),
  row(true, true, false, true)::text,
  'resolve_tag tells the owner a blank tag is theirs and unlinked, with its id to link it by');

-- ─── As account B ─────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000135","role":"authenticated"}', true);

WITH u AS (
  UPDATE public.tags SET dest_profile_id = (SELECT bi FROM ids) WHERE short_code = 'BLANK456' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM u), 0, 'another account can''t link someone else''s blank tag');

SELECT is(
  (SELECT row(tag_id, active, linked, owned_by_caller)::text FROM public.resolve_tag('BLANK456')),
  row(NULL::uuid, true, false, false)::text,
  'another account learns only that a blank tag isn''t set up: not its id');

SELECT is(
  (SELECT row(tag_id IS NOT NULL, linked, owned_by_caller, dest_project_id)::text FROM public.resolve_tag('BLANK234')),
  row(true, true, false, 'cccccccc-0000-0000-0000-0000000001a1'::uuid)::text,
  'a linked tag resolves to its destination for anyone, and says the caller doesn''t own it');

-- ─── As a stranger without an account ─────────────────────────────────

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT row(tag_id, active, linked, owned_by_caller)::text FROM public.resolve_tag('BLANK456')),
  row(NULL::uuid, true, false, false)::text,
  'a stranger learns only that a blank tag isn''t set up');

SELECT is(
  (SELECT row(tag_id, active, linked, owned_by_caller)::text FROM public.resolve_tag('PAUSED23')),
  row(NULL::uuid, false, NULL::boolean, NULL::boolean)::text,
  'a paused blank tag reveals nothing, not even that it is blank');

RESET ROLE;

-- The database owner reads the tag ids the stranger can't, to aim the inserts.
CREATE TEMP TABLE tag_ids ON COMMIT DROP AS
SELECT (SELECT id FROM public.tags WHERE short_code = 'BLANK456') AS blank,
       (SELECT id FROM public.tags WHERE short_code = 'BLANK234') AS linked;
GRANT SELECT ON tag_ids TO anon, authenticated;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT throws_ok(
  $$INSERT INTO public.scans (tag_id) VALUES ((SELECT blank FROM tag_ids))$$,
  '42501', NULL, 'a stranger''s Scan of a blank tag is refused: there is nowhere it was scanned to');

SELECT lives_ok(
  $$INSERT INTO public.scans (tag_id) VALUES ((SELECT linked FROM tag_ids))$$,
  'once linked, the same sticker records Scans like any tag');

RESET ROLE;

-- ─── As the database owner ────────────────────────────────────────────

SELECT lives_ok(
  $$UPDATE public.tags SET dest_project_id = (SELECT pj2 FROM ids) WHERE short_code = 'BLANK234'$$,
  'the database owner can still correct a destination, as before');

SELECT is(
  (SELECT provolatile::text FROM pg_proc WHERE proname = 'resolve_tag'),
  's', 'resolve_tag is still STABLE');

SELECT ok(
  has_function_privilege('anon', 'public.resolve_tag(text)', 'EXECUTE'),
  'anon may still resolve tags');

SELECT * FROM finish();
ROLLBACK;
