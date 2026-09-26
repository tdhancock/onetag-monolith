-- Embedded Tags, two follow-ups folded into ONE-44's batch (ONE-93, ONE-94).
--
-- 1. An embedded tag's host post is frozen, like its destination (ONE-86).
--    ONE-44's update policy already kept the new post the author's own, but
--    moving a tag between posts is still a tag changing what it is. The
--    position stays movable: that is what the update policy is for.
--
-- 2. Taps stay out of Scan History. ONE-44 records a tap on an embedded tag
--    as an ordinary scan, which is right for the tag owner's counts
--    (tag_scan_counts, unchanged). But Scan History is the log of places
--    someone scanned a Physical or Digital Tag, and a tap on a photo in the
--    feed is not one. scan_history is as ONE-35 left it, plus that filter.

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

  -- Every destination column. A new destination kind adds its column here,
  -- beside tags_one_destination.
  IF NEW.dest_profile_id IS DISTINCT FROM OLD.dest_profile_id
     OR NEW.dest_product_id IS DISTINCT FROM OLD.dest_product_id
     OR NEW.dest_project_id IS DISTINCT FROM OLD.dest_project_id THEN
    RAISE EXCEPTION 'a tag''s destination cannot be changed once it exists; create a replacement instead'
      USING ERRCODE = '42501';
  END IF;

  -- The post an embedded tag sits in (ONE-44). Moving a tag to another post
  -- is a new tag, as a new destination is.
  IF NEW.host_post_id IS DISTINCT FROM OLD.host_post_id THEN
    RAISE EXCEPTION 'an embedded tag''s post cannot be changed once it exists'
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
    'Freezes a tag''s short_code, destination (profile, product and project columns), host post, type and owner after insert. A new destination kind adds its column here.';

-- ─── scan_history without taps ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.scan_history(p_profile_id UUID)
RETURNS TABLE (
    dest_kind TEXT,
    dest_id UUID,
    dest_name TEXT,
    dest_username TEXT,
    scan_count BIGINT,
    last_scanned_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    h.dest_kind,
    h.dest_id,
    h.dest_name,
    h.dest_username,
    count(*),
    max(h.scanned_at)
  FROM (
    SELECT
      s.scanned_at,
      CASE
        WHEN t.dest_profile_id IS NOT NULL THEN 'profile'
        WHEN t.dest_product_id IS NOT NULL THEN 'product'
        ELSE 'project'
      END AS dest_kind,
      coalesce(t.dest_profile_id, t.dest_product_id, t.dest_project_id) AS dest_id,
      CASE
        WHEN t.dest_profile_id IS NOT NULL THEN coalesce(nullif(pr.full_name, ''), pr.username)
        WHEN t.dest_product_id IS NOT NULL THEN pd.name
        ELSE pj.name
      END AS dest_name,
      pr.username AS dest_username
    FROM public.scans s
    JOIN public.tags t ON t.id = s.tag_id
    LEFT JOIN public.profiles pr ON pr.id = t.dest_profile_id
    LEFT JOIN public.products pd ON pd.id = t.dest_product_id
    LEFT JOIN public.projects pj ON pj.id = t.dest_project_id
    WHERE s.scanner_profile_id = p_profile_id
      -- Taps on tags in posts are scans for the tag's owner's counts, not
      -- places someone has been.
      AND t.tag_type <> 'embedded'
      AND (
        public.owns_profile(p_profile_id)
        OR EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = p_profile_id AND me.scan_history_public)
      )
      AND (
        t.dest_project_id IS NULL
        OR pj.is_public
        OR public.owns_profile(pj.owner_profile_id)
        OR public.is_project_contributor(pj.id)
      )
  ) h
  GROUP BY h.dest_kind, h.dest_id, h.dest_name, h.dest_username
  ORDER BY max(h.scanned_at) DESC;
$$;

REVOKE ALL ON FUNCTION public.scan_history(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scan_history(UUID) TO anon, authenticated;
