-- A business is represented by its avatar: business_profiles.logo_url goes (ONE-81).
--
-- Decided 2026-09-27. A business profile's image is profiles.avatar_url, like
-- every other profile's: one image per profile, one upload path, nothing to
-- keep in step. Every surface already shows the avatar, including the tag page
-- (ONE-36). ONE-23 added logo_url beside category, website and location, but
-- nothing ever picked a logo or showed one. If a non-circular mark is ever
-- wanted, adding a column back is cheap.
--
-- The app stops selecting logo_url in the same change. PostgREST fails a whole
-- request that selects a column that doesn't exist, so a build still selecting
-- it would break on every profile read. None has shipped: there is no EAS
-- project and no store submission yet.

ALTER TABLE public.business_profiles DROP COLUMN logo_url;
