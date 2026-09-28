-- What admins may do, and nobody else (ONE-105). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back. ONE-105 changed how the
-- three admin-aware policies call is_admin() — once per query instead of once
-- per row — and not what they allow. This pins what they allow.
--
-- M: an admin. S: a stranger. P: private, with a post. Q: public, with a post.

BEGIN;
SELECT plan(9);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000105a0', 'm@one105.test', '{"username":"one105_m"}'),
  ('00000000-0000-0000-0000-0000000105a1', 's@one105.test', '{"username":"one105_s"}'),
  ('00000000-0000-0000-0000-0000000105a2', 'p@one105.test', '{"username":"one105_p"}'),
  ('00000000-0000-0000-0000-0000000105a3', 'q@one105.test', '{"username":"one105_q"}');
UPDATE public.profiles SET is_admin = true WHERE username = 'one105_m';
UPDATE public.profiles SET is_private = true WHERE username = 'one105_p';

INSERT INTO public.posts (id, user_id, content) VALUES
  ('10500000-0000-0000-0000-000000000001', (SELECT id FROM public.profiles WHERE username = 'one105_p'), 'private'),
  ('10500000-0000-0000-0000-000000000002', (SELECT id FROM public.profiles WHERE username = 'one105_q'), 'public'),
  ('10500000-0000-0000-0000-000000000003', (SELECT id FROM public.profiles WHERE username = 'one105_q'), 'doomed');

-- What each write touched, recorded from a top-level WITH.
CREATE TEMP TABLE touched (what TEXT, n INT) ON COMMIT DROP;
GRANT ALL ON touched TO authenticated;

SET LOCAL ROLE authenticated;

-- ─── A stranger ───────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000105a1","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.posts WHERE id::text LIKE '10500000%'), 2,
  'a stranger sees the public posts and not the private one');
WITH w AS (DELETE FROM public.posts WHERE id = '10500000-0000-0000-0000-000000000003' RETURNING 1) INSERT INTO touched SELECT 'delete0', count(*) FROM w;
SELECT is((SELECT n FROM touched WHERE what = 'delete0'), 0,
  'a stranger can''t delete someone else''s post');
WITH w AS (UPDATE public.profiles SET bio = 'hacked' WHERE username = 'one105_q' RETURNING 1) INSERT INTO touched SELECT 'update0', count(*) FROM w;
SELECT is((SELECT n FROM touched WHERE what = 'update0'), 0,
  'a stranger can''t update someone else''s profile');

-- ─── The admin ────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000105a0","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.posts WHERE id::text LIKE '10500000%'), 3,
  'an admin sees the private post too');
WITH w AS (DELETE FROM public.posts WHERE id = '10500000-0000-0000-0000-000000000003' RETURNING 1) INSERT INTO touched SELECT 'delete1', count(*) FROM w;
SELECT is((SELECT n FROM touched WHERE what = 'delete1'), 1,
  'an admin can delete any post');
WITH w AS (UPDATE public.profiles SET is_verified = true WHERE username = 'one105_q' RETURNING 1) INSERT INTO touched SELECT 'update1', count(*) FROM w;
SELECT is((SELECT n FROM touched WHERE what = 'update1'), 1,
  'an admin can update any profile, which is how verification works');

-- ─── And each policy calls is_admin() once per query ──────────────────

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public'
     AND (qual ~ '(^|[^T] )is_admin\(\)' OR with_check ~ '(^|[^T] )is_admin\(\)')
     AND NOT (coalesce(qual, '') ~ 'SELECT is_admin\(\)' OR coalesce(with_check, '') ~ 'SELECT is_admin\(\)')),
  0, 'no policy calls is_admin() bare, row by row');
SELECT ok((SELECT qual FROM pg_policies WHERE tablename = 'posts' AND policyname = 'Posts visible unless author is private')
          ~ 'SELECT is_admin\(\)', 'the posts read policy wraps it');
SELECT ok((SELECT qual FROM pg_policies WHERE tablename = 'posts' AND policyname = 'Admins can delete any post')
          ~ 'SELECT is_admin\(\)', 'so does the admin delete policy');

SELECT * FROM finish();
ROLLBACK;
