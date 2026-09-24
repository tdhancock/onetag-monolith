-- Multi-profile: one account, up to one Individual and one Business Profile.
--
-- `profiles.id` has been both the primary key and a foreign key to
-- auth.users(id): one account, one profile, and a profile id that *is* the
-- auth user id. This separates the two. A profile keeps its own `id` and
-- gains `user_id`, the account that owns it.
--
-- Additive, so it is safe on existing data: every row already has
-- `id = <its auth user id>`, so the backfill is `user_id = id`, and the id
-- values do not change — none of the tables referencing `profiles(id)` needs
-- touching.
--
-- Ships in the same deploy as 20260924120001_multi_profile_rls.sql. Every
-- ownership policy compares a profile column to auth.uid(); the moment a
-- profile id can differ from its owner's auth id those checks stop matching,
-- so schema and policies must land together (ONE-21).

-- ─── profiles.user_id ──────────────────────────────────────────────────

ALTER TABLE public.profiles
    ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE public.profiles SET user_id = id;

ALTER TABLE public.profiles ALTER COLUMN user_id SET NOT NULL;

-- `id` stops being a foreign key to auth.users. It stays the primary key with
-- the same values, so every foreign key pointing at profiles(id) is untouched.
-- Deleting an account still removes its profiles, through `user_id`'s cascade.
ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;
ALTER TABLE public.profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- ─── profiles.profile_type ─────────────────────────────────────────────

ALTER TABLE public.profiles
    ADD COLUMN profile_type TEXT NOT NULL DEFAULT 'individual'
    CHECK (profile_type IN ('individual', 'business'));

-- At most one profile of each type per account. Its leading column also
-- serves every lookup by `user_id` — the ownership helper runs one per row
-- checked — so a separate single-column index on user_id would only cost
-- writes.
CREATE UNIQUE INDEX profiles_one_per_type ON public.profiles (user_id, profile_type);

-- Handles stay globally unique across both types: `profiles_username_lower_key`
-- is left exactly as it is.

-- ─── push_tokens keys on the account ───────────────────────────────────
--
-- Push registration is per device per account, not per profile, and its
-- policies compare `user_id` to auth.uid(). But the column referenced
-- profiles(id), which only held while a profile id was its auth id — a new
-- account's first profile now gets a fresh id, and registering its device
-- would violate the foreign key. Existing rows hold auth ids already (they
-- were equal), so repointing needs no data change.
ALTER TABLE public.push_tokens DROP CONSTRAINT push_tokens_user_id_fkey;
ALTER TABLE public.push_tokens
    ADD CONSTRAINT push_tokens_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ─── Signup ────────────────────────────────────────────────────────────
--
-- A new account gets one Individual Profile with a fresh id. The username
-- derivation and collision handling are unchanged; only the insert's identity
-- columns and its conflict target differ.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  base_name TEXT;
  candidate TEXT;
BEGIN
  base_name := lower(regexp_replace(
    coalesce(NEW.raw_user_meta_data->>'username', split_part(coalesce(NEW.email, ''), '@', 1)),
    '[^a-z0-9_.]', '', 'gi'
  ));
  base_name := left(base_name, 20);
  IF char_length(base_name) < 3 THEN
    base_name := 'user_' || substr(NEW.id::text, 1, 6);
  END IF;

  candidate := base_name;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = candidate) THEN
    candidate := left(base_name, 15) || '_' || substr(NEW.id::text, 1, 4);
  END IF;

  INSERT INTO public.profiles (user_id, profile_type, username, full_name, avatar_url)
  VALUES (
    NEW.id,
    'individual',
    candidate,
    coalesce(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(coalesce(NEW.email, ''), '@', 1), 'OneTag User'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (user_id, profile_type) DO NOTHING;

  RETURN NEW;
END;
$$;
