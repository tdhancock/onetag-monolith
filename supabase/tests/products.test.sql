-- Products, their media and specs (ONE-37). Runs against a real database:
--
--   npm run db:test      (npx supabase test db — the LOCAL stack)
--
-- Everything runs in one transaction and rolls back.
--
-- Account A: individual AI (signup) and business AB. Lists product P.
-- Account B: individual BI (signup) and business BB. Owns nothing of A's.

BEGIN;
SELECT plan(24);

-- ─── Fixtures (as the database owner) ─────────────────────────────────

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000037', 'a@one37.test', '{"username":"one37_a"}'),
  ('bbbbbbbb-0000-0000-0000-000000000037', 'b@one37.test', '{"username":"one37_b"}');

INSERT INTO public.profiles (user_id, profile_type, username, full_name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000037', 'business', 'one37_a_biz', 'A Studio'),
  ('bbbbbbbb-0000-0000-0000-000000000037', 'business', 'one37_b_biz', 'B Works');
INSERT INTO public.business_profiles (profile_id, category)
SELECT id, 'Furniture' FROM public.profiles WHERE username IN ('one37_a_biz', 'one37_b_biz');

CREATE TEMP TABLE ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.profiles WHERE username = 'one37_a') AS ai,
  (SELECT id FROM public.profiles WHERE username = 'one37_a_biz') AS ab,
  (SELECT id FROM public.profiles WHERE username = 'one37_b_biz') AS bb,
  'eeeeeeee-0000-0000-0000-000000000037'::uuid AS p;
GRANT SELECT ON ids TO authenticated, anon;

-- ─── 1. Listing products, as account A ────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000037","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO public.products (business_profile_id, name) VALUES ((SELECT ai FROM ids), 'Chair')$$,
  '23514', NULL, 'an individual profile cannot list a product');

SELECT lives_ok(
  $$INSERT INTO public.products (id, business_profile_id, name, description, category)
    VALUES ((SELECT p FROM ids), (SELECT ab FROM ids), 'Walnut dining table', 'Solid walnut, seats eight', 'Tables')$$,
  'a business owner lists a product, with no price');

SELECT is(
  (SELECT row(price_cents, currency, available)::text FROM public.products WHERE id = (SELECT p FROM ids)),
  row(NULL::int, 'USD', true)::text,
  'a null price is valid: no price shown, in USD, available');

SELECT throws_ok(
  $$INSERT INTO public.products (business_profile_id, name, price_cents) VALUES ((SELECT ab FROM ids), 'Stool', -1)$$,
  '23514', NULL, 'a price cannot be negative');

SELECT lives_ok(
  $$INSERT INTO public.product_media (product_id, url, sort_order) VALUES ((SELECT p FROM ids), 'https://example.test/a.jpg', 0)$$,
  'the owner adds media to their own product');

SELECT lives_ok(
  $$INSERT INTO public.product_specs (product_id, label, value) VALUES ((SELECT p FROM ids), 'Wood', 'Walnut')$$,
  'the owner adds a spec to their own product');

WITH u AS (UPDATE public.products SET price_cents = 240000 WHERE id = (SELECT p FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 1, 'the owner updates their own product');

-- ─── 2. Another business, as account B ────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000037","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO public.products (business_profile_id, name) VALUES ((SELECT ab FROM ids), 'Forged')$$,
  '42501', NULL, 'another account cannot list a product on A''s business');

SELECT throws_ok(
  $$INSERT INTO public.product_media (product_id, url) VALUES ((SELECT p FROM ids), 'https://example.test/b.jpg')$$,
  '42501', NULL, 'another account cannot add media to A''s product');

SELECT throws_ok(
  $$INSERT INTO public.product_specs (product_id, label, value) VALUES ((SELECT p FROM ids), 'Wood', 'Pine')$$,
  '42501', NULL, 'another account cannot add a spec to A''s product');

WITH u AS (UPDATE public.products SET name = 'hijacked' WHERE id = (SELECT p FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 0, 'another account cannot update A''s product');

WITH u AS (UPDATE public.product_media SET url = 'https://example.test/x.jpg' WHERE product_id = (SELECT p FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 0, 'another account cannot update A''s media');

WITH d AS (DELETE FROM public.products WHERE id = (SELECT p FROM ids) RETURNING 1)
SELECT is((SELECT count(*)::int FROM d), 0, 'another account cannot delete A''s product');

SELECT lives_ok(
  $$INSERT INTO public.products (business_profile_id, name) VALUES ((SELECT bb FROM ids), 'B chair')$$,
  'B lists on its own business');

-- ─── 3. Anonymous ─────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT ok((SELECT count(*) FROM public.products WHERE id = (SELECT p FROM ids)) = 1,
  'an anonymous client reads a product');
SELECT ok((SELECT count(*) FROM public.product_media WHERE product_id = (SELECT p FROM ids)) = 1,
  'an anonymous client reads its media');
SELECT ok((SELECT count(*) FROM public.product_specs WHERE product_id = (SELECT p FROM ids)) = 1,
  'an anonymous client reads its specs');

SELECT throws_ok(
  $$INSERT INTO public.products (business_profile_id, name) VALUES ((SELECT ab FROM ids), 'Anon')$$,
  '42501', NULL, 'an anonymous client cannot insert a product');

-- ─── 4. Search groundwork, and the cascade (as the database owner) ────

RESET ROLE;

SELECT ok(
  (SELECT search_vector @@ to_tsquery('english', 'walnut & eight') FROM public.products WHERE id = (SELECT p FROM ids)),
  'the tsvector is populated from the name and description');

SELECT has_index('public', 'products', 'products_search_vector', 'the tsvector is indexed');

SELECT is(
  (SELECT amname::text FROM pg_class c JOIN pg_am a ON a.oid = c.relam WHERE c.relname = 'products_search_vector'),
  'gin', 'with a GIN index');

SELECT has_trigger('public', 'products', 'products_set_updated_at', 'updated_at is stamped by the database');

DELETE FROM public.products WHERE id = (SELECT p FROM ids);

SELECT is((SELECT count(*)::int FROM public.product_media WHERE product_id = (SELECT p FROM ids)), 0,
  'deleting a product removes its media');
SELECT is((SELECT count(*)::int FROM public.product_specs WHERE product_id = (SELECT p FROM ids)), 0,
  'and its specs');

SELECT * FROM finish();
ROLLBACK;
