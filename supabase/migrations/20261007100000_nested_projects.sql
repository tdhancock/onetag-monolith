-- Projects inside a project, one level deep (ONE-134).
--
-- Decided 2026-10-06: a house is a project, and its furnace, AC and water
-- heater are projects inside it, each with its own tag. Nesting is how a
-- project keeps an inventory, and why no sixth kind of Destination is needed:
-- a tag, a save and a scan already refer to a project by its id.
--
--   parent_project_id   the project this one sits inside, or null; deleting
--                       the parent deletes what is inside it
--   check_project_parent  one level only, and only inside a project with the
--                       same owner
--
-- Each project keeps its own visibility: a private furnace may sit in a public
-- house, and the other way round. RLS needs no change — a project's own
-- update policy already says only its owner moves it.

ALTER TABLE public.projects
    ADD COLUMN parent_project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE;

-- The projects inside one, and the cascade when it is deleted.
CREATE INDEX projects_parent_project_id ON public.projects (parent_project_id) WHERE parent_project_id IS NOT NULL;

-- ─── One level, one owner ─────────────────────────────────────────────
--
-- SECURITY DEFINER so it reads a parent and its children whatever the caller
-- may see: a parent hidden by RLS must be refused for the right reason, not
-- waved through because it read as absent. It answers nothing to anyone; it
-- only refuses.

CREATE OR REPLACE FUNCTION public.check_project_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent RECORD;
BEGIN
  -- A project that holds others keeps its owner: what is inside it is the
  -- same owner's, and must stay so.
  IF TG_OP = 'UPDATE'
     AND NEW.owner_profile_id IS DISTINCT FROM OLD.owner_profile_id
     AND EXISTS (SELECT 1 FROM public.projects WHERE parent_project_id = NEW.id) THEN
    RAISE EXCEPTION 'a project with projects inside it cannot change owner'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.parent_project_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_project_id = NEW.id THEN
    RAISE EXCEPTION 'a project cannot sit inside itself'
      USING ERRCODE = '23514';
  END IF;

  SELECT owner_profile_id, parent_project_id INTO parent
  FROM public.projects WHERE id = NEW.parent_project_id;

  -- A parent that doesn't exist is the foreign key's to refuse.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF parent.parent_project_id IS NOT NULL THEN
    RAISE EXCEPTION 'a project inside another cannot hold projects: one level only'
      USING ERRCODE = '23514';
  END IF;

  IF parent.owner_profile_id IS DISTINCT FROM NEW.owner_profile_id THEN
    RAISE EXCEPTION 'a project can only sit inside a project with the same owner'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM public.projects WHERE parent_project_id = NEW.id) THEN
    RAISE EXCEPTION 'a project with projects inside it cannot sit inside another: one level only'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- A trigger function, never called directly.
REVOKE ALL ON FUNCTION public.check_project_parent() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER projects_check_parent
    BEFORE INSERT OR UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.check_project_parent();

COMMENT ON COLUMN public.projects.parent_project_id IS
    'The project this one sits inside, one level deep and with the same owner (ONE-134), or null.';
