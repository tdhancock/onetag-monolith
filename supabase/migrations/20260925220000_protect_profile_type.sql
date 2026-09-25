-- Freeze profiles.profile_type once a profile exists (ONE-79).
--
-- `business_profiles_require_business` (ONE-23) keeps a business row on a
-- business profile, but it fires only on writes to business_profiles. The
-- owner's update policy on profiles covers every column of their own row,
-- profile_type included, so a direct API call could flip a business profile
-- to individual — stranding its business row — or flip the account's only
-- individual profile to business.
--
-- No app path changes profile_type after insert, and converting a profile
-- between types is not a planned feature, so the column is frozen for
-- everyone but the database owner. App admins are not exempt: converting a
-- profile is not an admin feature.
--
-- Its own function and trigger, beside protect_profile_verified rather than
-- folded into it, so each guard reads on its own.

CREATE OR REPLACE FUNCTION public.protect_profile_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  -- The same definition protect_profile_verified uses
  -- (20260921000000_admin_and_privacy.sql).
  privileged BOOLEAN := current_user IN ('postgres', 'supabase_admin', 'service_role')
                        OR coalesce(auth.role(), 'service_role') = 'service_role';
BEGIN
  IF NEW.profile_type IS DISTINCT FROM OLD.profile_type AND NOT privileged THEN
    RAISE EXCEPTION 'profile_type cannot be changed once a profile exists'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_protect_type
    BEFORE UPDATE OF profile_type ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.protect_profile_type();
