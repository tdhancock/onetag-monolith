-- Business Profile fields, in an extension table (ONE-23).
--
-- A Business Profile carries fields an Individual Profile does not: a
-- category, a website, a location and a logo. They live here rather than as
-- nullable columns on `profiles`, which would be null for every individual
-- and leave nowhere for the business-only fields M5 adds.
--
-- This is a strict extension of a profile row — one row per business
-- profile, keyed on the profile's own id — not the polymorphic
-- `business_profiles` of the reference handoff. There is no second id space
-- and no owner_type column (Working Agreement, locked decisions).
--
-- `logo_url` points into the existing `avatars` bucket. A logo is the same
-- kind of asset as an avatar, with the same size limit, and that bucket's
-- policies already key each upload on `auth.uid()` in its folder name — so
-- there is no third bucket and no new storage policy.
--
-- Additive: nothing reads it until the client that ships with it does.

CREATE TABLE public.business_profiles (
    -- The primary key *is* the foreign key: one extension row per profile,
    -- with no separate constraint to keep in step.
    profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    category TEXT,
    -- Stored normalized, scheme included, so it opens wherever it is tapped.
    -- The app normalizes before saving; the check keeps anything but a web
    -- link — a javascript: or custom-scheme URL — out of a field the app
    -- hands straight to the OS to open.
    website TEXT CHECK (website IS NULL OR website ~* '^https?://[^[:space:]]+$'),
    location TEXT,
    logo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Only a business profile gets business fields ─────────────────────
--
-- Without this nothing stops an individual profile acquiring a category and
-- a website. Checked on insert, and on any update that re-points the row at
-- another profile.

CREATE OR REPLACE FUNCTION public.business_profiles_require_business()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.profile_id AND profile_type = 'business'
  ) THEN
    RAISE EXCEPTION 'business fields belong only to a business profile'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER business_profiles_require_business
    BEFORE INSERT OR UPDATE OF profile_id ON public.business_profiles
    FOR EACH ROW EXECUTE FUNCTION public.business_profiles_require_business();

-- ─── RLS ──────────────────────────────────────────────────────────────
--
-- Readable by everyone, signed in or not: a business profile is a public
-- discovery surface, and a scanned Tag resolves to one for someone without
-- the app. Every write goes through the ownership helper from the
-- multi-profile migration, on the profile the row extends.

ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Business profiles are viewable by everyone" ON public.business_profiles
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Users can create own business profile" ON public.business_profiles
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.owns_profile(profile_id)));

CREATE POLICY "Users can update own business profile" ON public.business_profiles
    FOR UPDATE TO authenticated
    USING ((SELECT public.owns_profile(profile_id)))
    WITH CHECK ((SELECT public.owns_profile(profile_id)));

CREATE POLICY "Users can delete own business profile" ON public.business_profiles
    FOR DELETE TO authenticated USING ((SELECT public.owns_profile(profile_id)));
