-- Freeze what a tag is once it exists (ONE-86).
--
-- A tag's short code is printed on stickers, and its destination is what
-- people scanned to reach. "Users can update own tags" (ONE-27) lets an owner
-- update any column of their own tag, checking only that they own the tag and
-- its destination — so a direct API call could rewrite the short code, killing
-- every sticker that carries the old one, or repoint the tag at another of the
-- account's profiles, sending everyone who scans it somewhere new. The app
-- never offers either (ONE-34): a damaged tag is replaced by a new tag with
-- the same destination, not edited.
--
-- So once a tag exists its short code, destination, type and owner are fixed
-- for everyone but the database owner, as profiles.profile_type is (ONE-79).
-- Its name, note and whether it is active stay the owner's to change.
--
-- A plain BEFORE UPDATE, not BEFORE UPDATE OF a column list: M5 adds product
-- and project destination columns (ONE-38), and a column forgotten in a
-- trigger's OF list is silently unguarded. Here it is one more IF.

CREATE OR REPLACE FUNCTION public.protect_tag_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  -- The same definition protect_profile_verified and protect_profile_type use.
  privileged BOOLEAN := current_user IN ('postgres', 'supabase_admin', 'service_role')
                        OR coalesce(auth.role(), 'service_role') = 'service_role';
BEGIN
  IF privileged THEN
    RETURN NEW;
  END IF;

  IF NEW.short_code IS DISTINCT FROM OLD.short_code THEN
    RAISE EXCEPTION 'a tag''s short_code cannot be changed once it exists'
      USING ERRCODE = '42501';
  END IF;

  -- M5 MUST add its product and project destination columns here, beside
  -- extending tags_one_destination.
  IF NEW.dest_profile_id IS DISTINCT FROM OLD.dest_profile_id THEN
    RAISE EXCEPTION 'a tag''s destination cannot be changed once it exists; create a replacement instead'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.tag_type IS DISTINCT FROM OLD.tag_type THEN
    RAISE EXCEPTION 'a tag''s type cannot be changed once it exists'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.owner_profile_id IS DISTINCT FROM OLD.owner_profile_id THEN
    RAISE EXCEPTION 'a tag''s owner cannot be changed once it exists'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_tag_identity() IS
    'Freezes a tag''s short_code, destination, type and owner after insert. M5 must add its product and project destination columns.';

CREATE TRIGGER tags_protect_identity
    BEFORE UPDATE ON public.tags
    FOR EACH ROW EXECUTE FUNCTION public.protect_tag_identity();
