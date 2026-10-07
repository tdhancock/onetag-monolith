-- A block prevents an embedded tag, in either direction (ONE-93). Runs
-- against a real database:
--
--   pnpm db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- A: the author, with image post POST.
-- B: business BB, which blocked A. Lists product BLAMP.
-- C: individual, whom A blocked.
-- D: owns public project DLOFT; blocked A.
-- E: business EB, no block either way. Lists product ELAMP.

BEGIN;
SELECT plan(7);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000093a0', 'a@one93.test', '{"username":"one93_a"}'),
  ('00000000-0000-0000-0000-0000000093a1', 'b@one93.test', '{"username":"one93_b"}'),
  ('00000000-0000-0000-0000-0000000093a2', 'c@one93.test', '{"username":"one93_c"}'),
  ('00000000-0000-0000-0000-0000000093a3', 'd@one93.test', '{"username":"one93_d"}'),
  ('00000000-0000-0000-0000-0000000093a4', 'e@one93.test', '{"username":"one93_e"}');

INSERT INTO public.profiles (user_id, profile_type, username, full_name) VALUES
  ('00000000-0000-0000-0000-0000000093a1', 'business', 'one93_bb', 'B Works'),
  ('00000000-0000-0000-0000-0000000093a4', 'business', 'one93_eb', 'E Works');
INSERT INTO public.business_profiles (profile_id)
  SELECT id FROM public.profiles WHERE username IN ('one93_bb', 'one93_eb');

INSERT INTO public.blocks (blocker_id, blocked_id) VALUES
  ('00000000-0000-0000-0000-0000000093a1', '00000000-0000-0000-0000-0000000093a0'),
  ('00000000-0000-0000-0000-0000000093a0', '00000000-0000-0000-0000-0000000093a2'),
  ('00000000-0000-0000-0000-0000000093a3', '00000000-0000-0000-0000-0000000093a0');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one93_a') AS a,
  (SELECT id FROM public.profiles WHERE username = 'one93_bb') AS bb,
  (SELECT id FROM public.profiles WHERE username = 'one93_c') AS c,
  '93000000-0000-0000-0000-000000000001'::uuid AS post,
  '93000000-0000-0000-0000-0000000000a1'::uuid AS blamp,
  '93000000-0000-0000-0000-0000000000a2'::uuid AS elamp,
  '93000000-0000-0000-0000-0000000000b1'::uuid AS dloft;
GRANT SELECT ON ids TO authenticated;

INSERT INTO public.posts (id, user_id, image_url, media_type) SELECT post, a, 'p.jpg', 'image' FROM ids;
INSERT INTO public.products (id, business_profile_id, name) VALUES
  ('93000000-0000-0000-0000-0000000000a1', (SELECT bb FROM ids), 'B Lamp'),
  ('93000000-0000-0000-0000-0000000000a2', (SELECT id FROM public.profiles WHERE username = 'one93_eb'), 'E Lamp');
INSERT INTO public.projects (id, owner_profile_id, name, is_public) VALUES
  ('93000000-0000-0000-0000-0000000000b1', (SELECT id FROM public.profiles WHERE username = 'one93_d'), 'D Loft', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000093a0","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id, host_post_id, tag_x_pct, tag_y_pct, short_code)
    SELECT a, 'embedded', elamp, post, 10, 10, 'NewTag23' FROM ids$$,
  'with no block either way, the author tags another business''s product');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_product_id, host_post_id, tag_x_pct, tag_y_pct)
    SELECT a, 'embedded', blamp, post, 20, 20 FROM ids$$,
  '42501', NULL, 'a business that blocked the author can''t have its product tagged by them');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_profile_id, host_post_id, tag_x_pct, tag_y_pct)
    SELECT a, 'embedded', bb, post, 20, 20 FROM ids$$,
  '42501', NULL, 'nor the business profile itself');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_profile_id, host_post_id, tag_x_pct, tag_y_pct)
    SELECT a, 'embedded', c, post, 30, 30 FROM ids$$,
  '42501', NULL, 'the author can''t tag someone they blocked');

SELECT throws_ok(
  $$INSERT INTO public.tags (owner_profile_id, tag_type, dest_project_id, host_post_id, tag_x_pct, tag_y_pct)
    SELECT a, 'embedded', dloft, post, 40, 40 FROM ids$$,
  '42501', NULL, 'a project whose owner blocked the author can''t be tagged');

SELECT lives_ok(
  $$UPDATE public.tags SET tag_x_pct = 55 WHERE short_code = 'NewTag23'$$,
  'a tag with no block either way can still be moved');

RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.embedded_tag_destination_owner(uuid, uuid, uuid)', 'EXECUTE'),
  'anon cannot execute embedded_tag_destination_owner()');

SELECT * FROM finish();
ROLLBACK;
