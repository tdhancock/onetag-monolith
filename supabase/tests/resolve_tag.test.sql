-- resolve_tag: one read that tells a missing code from a paused tag from a
-- live one (ONE-30). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account A: individual profile AA (signup trigger) and a post AP.
-- Tag LIVE points at AA; tag POST points at AP; tag PAUSED points at AA and
-- is inactive.

BEGIN;
SELECT plan(9);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000030', 'a@one30.test', '{"username":"one30_a"}');

INSERT INTO public.posts (id, user_id, content) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000f0', (SELECT id FROM public.profiles WHERE username = 'one30_a'), 'A''s post');

INSERT INTO public.tags (id, owner_profile_id, tag_type, format, dest_profile_id, short_code) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', (SELECT id FROM public.profiles WHERE username = 'one30_a'),
   'physical', 'qr', (SELECT id FROM public.profiles WHERE username = 'one30_a'), 'LiveTag2');
INSERT INTO public.tags (id, owner_profile_id, tag_type, dest_post_id, short_code) VALUES
  ('eeeeeeee-0000-0000-0000-000000000002', (SELECT id FROM public.profiles WHERE username = 'one30_a'),
   'digital', 'aaaaaaaa-0000-0000-0000-0000000000f0', 'PostTag3');
INSERT INTO public.tags (id, owner_profile_id, tag_type, format, dest_profile_id, short_code, active) VALUES
  ('eeeeeeee-0000-0000-0000-000000000003', (SELECT id FROM public.profiles WHERE username = 'one30_a'),
   'physical', 'qr', (SELECT id FROM public.profiles WHERE username = 'one30_a'), 'Paused45', false);

-- ─── As a stranger without an account ─────────────────────────────────

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT row(tag_id, active, dest_profile_username, dest_post_id)::text FROM public.resolve_tag('LiveTag2')),
  row('eeeeeeee-0000-0000-0000-000000000001'::uuid, true, 'one30_a', NULL::uuid)::text,
  'an anonymous caller resolves an active profile tag to its id and the profile''s handle');

SELECT is(
  (SELECT dest_post_id FROM public.resolve_tag('PostTag3')),
  'aaaaaaaa-0000-0000-0000-0000000000f0'::uuid,
  'an active post tag resolves to its post');

SELECT is(
  (SELECT count(*)::int FROM public.resolve_tag('Nope2345')),
  0, 'an unknown code resolves to nothing');

SELECT is(
  (SELECT active FROM public.resolve_tag('Paused45')),
  false, 'a paused tag resolves as inactive, distinct from an unknown code');

SELECT is(
  (SELECT row(tag_id, dest_profile_id, dest_profile_username, dest_post_id)::text FROM public.resolve_tag('Paused45')),
  row(NULL::uuid, NULL::uuid, NULL::text, NULL::uuid)::text,
  'a paused tag reveals neither its id nor where it points');

SELECT is(
  (SELECT count(*)::int FROM public.tags WHERE short_code = 'Paused45'),
  0, 'the table itself still hides the paused tag from a stranger');

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
