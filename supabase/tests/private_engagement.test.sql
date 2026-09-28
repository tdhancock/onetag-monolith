-- A private post's comments, likes and reposts are as private as the post
-- (ONE-109). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- P: private, with post PP, a OneSnap, and a comment of their own.
-- F: follows P; comments on, likes and reposts PP, likes P's comment and
--    OneSnap.
-- S: a stranger. Q: public, with post QP, which C comments on. X blocked C.

BEGIN;
SELECT plan(17);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000109a0', 'p@one109.test', '{"username":"one109_p"}'),
  ('00000000-0000-0000-0000-0000000109a1', 'f@one109.test', '{"username":"one109_f"}'),
  ('00000000-0000-0000-0000-0000000109a2', 's@one109.test', '{"username":"one109_s"}'),
  ('00000000-0000-0000-0000-0000000109a3', 'q@one109.test', '{"username":"one109_q"}'),
  ('00000000-0000-0000-0000-0000000109a4', 'c@one109.test', '{"username":"one109_c"}'),
  ('00000000-0000-0000-0000-0000000109a5', 'x@one109.test', '{"username":"one109_x"}');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one109_p') AS p,
  (SELECT id FROM public.profiles WHERE username = 'one109_f') AS f,
  (SELECT id FROM public.profiles WHERE username = 'one109_q') AS q,
  (SELECT id FROM public.profiles WHERE username = 'one109_c') AS c;
GRANT SELECT ON ids TO authenticated;

UPDATE public.profiles SET is_private = true WHERE username = 'one109_p';
INSERT INTO public.follows (follower_id, followed_id) SELECT f, p FROM ids;

INSERT INTO public.posts (id, user_id, content) VALUES
  ('10900000-0000-0000-0000-000000000001', (SELECT p FROM ids), 'private post'),
  ('10900000-0000-0000-0000-000000000002', (SELECT q FROM ids), 'public post');
INSERT INTO public.stories (id, user_id, media_url) VALUES
  ('10900000-0000-0000-0000-000000000011', (SELECT p FROM ids), 'p.jpg');
INSERT INTO public.comments (id, post_id, user_id, content) VALUES
  ('10900000-0000-0000-0000-000000000021', '10900000-0000-0000-0000-000000000001', (SELECT p FROM ids), 'a private comment'),
  ('10900000-0000-0000-0000-000000000022', '10900000-0000-0000-0000-000000000001', (SELECT f FROM ids), 'a follower''s comment'),
  ('10900000-0000-0000-0000-000000000023', '10900000-0000-0000-0000-000000000002', (SELECT c FROM ids), 'C on Q'),
  ('10900000-0000-0000-0000-000000000024', '10900000-0000-0000-0000-000000000002', (SELECT q FROM ids), 'Q on Q');
INSERT INTO public.likes (post_id, user_id) SELECT '10900000-0000-0000-0000-000000000001', f FROM ids;
INSERT INTO public.reposts (post_id, user_id) SELECT '10900000-0000-0000-0000-000000000001', f FROM ids;
INSERT INTO public.comment_likes (comment_id, user_id) SELECT '10900000-0000-0000-0000-000000000021', f FROM ids;
INSERT INTO public.story_likes (story_id, user_id) SELECT '10900000-0000-0000-0000-000000000011', f FROM ids;
INSERT INTO public.blocks (blocker_id, blocked_id) VALUES
  ('00000000-0000-0000-0000-0000000109a5', '00000000-0000-0000-0000-0000000109a4');

SET LOCAL ROLE authenticated;

-- ─── A stranger ───────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000109a2","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.comments WHERE post_id = '10900000-0000-0000-0000-000000000001'), 0,
  'a stranger reads no comment on a private post');
SELECT is((SELECT count(*)::int FROM public.likes WHERE post_id = '10900000-0000-0000-0000-000000000001'), 0,
  'nor who liked it');
SELECT is((SELECT count(*)::int FROM public.reposts WHERE post_id = '10900000-0000-0000-0000-000000000001'), 0,
  'nor who reposted it');
SELECT is((SELECT count(*)::int FROM public.comment_likes WHERE comment_id = '10900000-0000-0000-0000-000000000021'), 0,
  'nor who liked a comment on it');
SELECT is((SELECT count(*)::int FROM public.story_likes WHERE story_id = '10900000-0000-0000-0000-000000000011'), 0,
  'nor who liked the private OneSnap');
SELECT is((SELECT count(*)::int FROM public.explore_scores WHERE post_id = '10900000-0000-0000-0000-000000000001'), 0,
  'nor its stored counts');
SELECT is((SELECT count(*)::int FROM public.comments WHERE post_id = '10900000-0000-0000-0000-000000000002'), 2,
  'a public post''s comments are read as before');
SELECT is((SELECT likes FROM public.explore_scores WHERE post_id = '10900000-0000-0000-0000-000000000002'), 0,
  'and its stored counts');

-- ─── A follower ───────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000109a1","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.comments WHERE post_id = '10900000-0000-0000-0000-000000000001'), 2,
  'a follower reads the comments on the private post');
SELECT is((SELECT count(*)::int FROM public.likes WHERE post_id = '10900000-0000-0000-0000-000000000001'), 1,
  'and who liked it');
SELECT is((SELECT count(*)::int FROM public.comment_likes WHERE comment_id = '10900000-0000-0000-0000-000000000021'), 1,
  'and the comment''s likes');
SELECT is((SELECT count(*)::int FROM public.story_likes WHERE story_id = '10900000-0000-0000-0000-000000000011'), 1,
  'and the OneSnap''s likes');
SELECT is((SELECT likes FROM public.explore_scores WHERE post_id = '10900000-0000-0000-0000-000000000001'), 1,
  'and its stored counts');

-- ─── The owner ────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000109a0","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.comments WHERE post_id = '10900000-0000-0000-0000-000000000001'), 2,
  'the owner reads every comment on their post');
SELECT is((SELECT count(*)::int FROM public.reposts WHERE post_id = '10900000-0000-0000-0000-000000000001'), 1,
  'and every repost');

-- ─── Across a block ───────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000109a5","role":"authenticated"}', true);
SELECT is(
  (SELECT array_agg(content) FROM public.comments WHERE post_id = '10900000-0000-0000-0000-000000000002'),
  ARRAY['Q on Q'], 'someone who blocked a commenter doesn''t see their comment on a public post');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000109a4","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.comments WHERE post_id = '10900000-0000-0000-0000-000000000002'), 2,
  'the commenter still sees every comment there, since only X blocked them');

SELECT * FROM finish();
ROLLBACK;
