-- resolve_tag: one read that tells a missing code from a paused tag from a
-- live one (ONE-30). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account A: individual profile AA (signup trigger). Tag LIVE (physical) and
-- tag SHARED (digital) point at AA; tag PAUSED points at AA and is inactive.
-- A's business profile AB lists product PR; A owns private project PJ (ONE-38).
-- Tag PRODUCT points at PR, tag GONEPROD at PR and is paused, tag PROJECT at PJ.

BEGIN;
SELECT plan(13);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000030', 'a@one30.test', '{"username":"one30_a"}');

INSERT INTO public.profiles (user_id, profile_type, username, full_name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000030', 'business', 'one30_a_biz', 'A Studio');
INSERT INTO public.business_profiles (profile_id) SELECT id FROM public.profiles WHERE username = 'one30_a_biz';
INSERT INTO public.products (id, business_profile_id, name)
VALUES ('eeeeeeee-0000-0000-0000-0000000000a1', (SELECT id FROM public.profiles WHERE username = 'one30_a_biz'), 'Lamp');
INSERT INTO public.projects (id, owner_profile_id, name, is_public)
VALUES ('eeeeeeee-0000-0000-0000-0000000000b1', (SELECT id FROM public.profiles WHERE username = 'one30_a'), 'Loft', false);

INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id, short_code) VALUES
  ((SELECT id FROM public.profiles WHERE username = 'one30_a_biz'), 'digital', 'eeeeeeee-0000-0000-0000-0000000000a1', 'Product2');
INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id, short_code, active) VALUES
  ((SELECT id FROM public.profiles WHERE username = 'one30_a_biz'), 'digital', 'eeeeeeee-0000-0000-0000-0000000000a1', 'GoneProd', false);
INSERT INTO public.tags (owner_profile_id, tag_type, dest_project_id, short_code) VALUES
  ((SELECT id FROM public.profiles WHERE username = 'one30_a'), 'digital', 'eeeeeeee-0000-0000-0000-0000000000b1', 'Project2');

INSERT INTO public.tags (id, owner_profile_id, tag_type, format, dest_profile_id, short_code) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', (SELECT id FROM public.profiles WHERE username = 'one30_a'),
   'physical', 'qr', (SELECT id FROM public.profiles WHERE username = 'one30_a'), 'LiveTag2');
INSERT INTO public.tags (id, owner_profile_id, tag_type, dest_profile_id, short_code) VALUES
  ('eeeeeeee-0000-0000-0000-000000000002', (SELECT id FROM public.profiles WHERE username = 'one30_a'),
   'digital', (SELECT id FROM public.profiles WHERE username = 'one30_a'), 'Shared23');
INSERT INTO public.tags (id, owner_profile_id, tag_type, format, dest_profile_id, short_code, active) VALUES
  ('eeeeeeee-0000-0000-0000-000000000003', (SELECT id FROM public.profiles WHERE username = 'one30_a'),
   'physical', 'qr', (SELECT id FROM public.profiles WHERE username = 'one30_a'), 'Paused45', false);

-- ─── As a stranger without an account ─────────────────────────────────

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT row(tag_id, active, dest_profile_username)::text FROM public.resolve_tag('LiveTag2')),
  row('eeeeeeee-0000-0000-0000-000000000001'::uuid, true, 'one30_a')::text,
  'an anonymous caller resolves an active profile tag to its id and the profile''s handle');

SELECT is(
  (SELECT tag_id FROM public.resolve_tag('Shared23')),
  'eeeeeeee-0000-0000-0000-000000000002'::uuid,
  'an active digital tag resolves the same way');

SELECT is(
  (SELECT count(*)::int FROM public.resolve_tag('Nope2345')),
  0, 'an unknown code resolves to nothing');

SELECT is(
  (SELECT active FROM public.resolve_tag('Paused45')),
  false, 'a paused tag resolves as inactive, distinct from an unknown code');

SELECT is(
  (SELECT row(tag_id, dest_profile_id, dest_profile_username)::text FROM public.resolve_tag('Paused45')),
  row(NULL::uuid, NULL::uuid, NULL::text)::text,
  'a paused tag reveals neither its id nor where it points');

SELECT is(
  (SELECT count(*)::int FROM public.tags),
  0, 'the table itself hides every tag from a stranger — resolve_tag is the only way in');

SELECT is(
  (SELECT row(dest_product_id, dest_profile_id, dest_project_id)::text FROM public.resolve_tag('Product2')),
  row('eeeeeeee-0000-0000-0000-0000000000a1'::uuid, NULL::uuid, NULL::uuid)::text,
  'an active product tag resolves to its product (ONE-38)');

SELECT is(
  (SELECT row(active, dest_product_id)::text FROM public.resolve_tag('GoneProd')),
  row(false, NULL::uuid)::text,
  'a paused product tag reveals no product');

SELECT is(
  (SELECT dest_project_id FROM public.resolve_tag('Project2')),
  'eeeeeeee-0000-0000-0000-0000000000b1'::uuid,
  'an active project tag resolves to its project');

SELECT is(
  (SELECT count(*)::int FROM public.projects WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'),
  0, 'a private project is still hidden from the stranger it resolved for — the screen says not found');

-- ─── As a signed-in account ───────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000030","role":"authenticated"}', true);

SELECT is(
  (SELECT active FROM public.resolve_tag('LiveTag2')),
  true, 'a signed-in caller resolves the same way');

RESET ROLE;

SELECT ok(
  has_function_privilege('anon', 'public.resolve_tag(text)', 'EXECUTE'),
  'anon may resolve tags');

SELECT is(
  (SELECT provolatile::text FROM pg_proc WHERE proname = 'resolve_tag'),
  's', 'resolve_tag is STABLE — it reads, never writes');

SELECT * FROM finish();
ROLLBACK;
