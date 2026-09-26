-- Projects, Contributors, the Products a project uses, and the last two
-- Tag Destinations (ONE-38).
--
-- A Project is a build, install or completed work: the heart of Waterfall
-- Discovery. It Links Contributors — the profiles who took part, business or
-- individual, whatever part they played — and the Products it used, and discovery runs
-- both ways: a project lists its contributors, and a profile lists the
-- projects it contributed to.
--
-- Either profile type may own a project; an individual documenting their own
-- build is a first-class case, unlike products (ONE-37), which are
-- business-only.
--
-- This migration also completes tags: products and projects become
-- destinations beside profiles, so a tag points at exactly one of the four
-- kinds — a Business Profile, an Individual Profile (both in profiles), a
-- Product or a Project. A post is not a Destination (ONE-83).
--
-- Additive for the client: nothing reads these tables until the product,
-- project and contributor screens (ONE-40, ONE-41, ONE-42).

-- ─── projects ─────────────────────────────────────────────────────────

CREATE TABLE public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    project_type TEXT,
    description TEXT,
    cover_url TEXT,
    year TEXT,
    -- Public or Private, in the glossary's words. Not a bare `public`, which
    -- reads badly in policies.
    is_public BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Search groundwork for M6, matching products.
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english'::regconfig, coalesce(name, '')), 'A')
        || setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'B')
    ) STORED
);

CREATE INDEX projects_owner_profile_id_created_at ON public.projects (owner_profile_id, created_at DESC);
CREATE INDEX projects_search_vector ON public.projects USING GIN (search_vector);

CREATE TRIGGER projects_set_updated_at
    BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── contributors ─────────────────────────────────────────────────────
--
-- A profile Linked to a project. Being named a Contributor is a public claim
-- about someone else, so the project's owner adds the link and the
-- contributor can always remove it (see RLS below).

CREATE TABLE public.contributors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    contributor_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT,
    -- A hidden link is visible only to the project's owner and the contributor.
    is_public BOOLEAN NOT NULL DEFAULT true,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A profile is Linked to a project once. Its index also serves every
    -- lookup by project, so there is no separate contributors(project_id).
    UNIQUE (project_id, contributor_profile_id)
);

-- The reverse lookup: the projects a profile contributed to.
CREATE INDEX contributors_contributor_profile_id ON public.contributors (contributor_profile_id);

-- ─── project_products ─────────────────────────────────────────────────
--
-- The Products a project used. A project may Link products it does not own —
-- a builder's project showcasing other businesses' products is the point —
-- so the link belongs to the project's owner, not the product's.

CREATE TABLE public.project_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    -- Its index also serves every lookup by project.
    UNIQUE (project_id, product_id)
);

-- The reverse lookup: the projects a product is used in.
CREATE INDEX project_products_product_id ON public.project_products (product_id);

-- ─── Who contributes to a project ─────────────────────────────────────
--
-- A private project is visible to its contributors, and a contributor link
-- is visible with its project — each table's read depends on the other. Two
-- policies querying each other's tables would recurse, so the project side
-- asks this instead. SECURITY DEFINER so it reads contributors without their
-- RLS; it answers yes or no about the caller and one project, and nothing
-- else. For signed-in callers only: anon has no profile to be a contributor
-- with.

CREATE OR REPLACE FUNCTION public.is_project_contributor(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.contributors c
    WHERE c.project_id = p_project_id AND public.owns_profile(c.contributor_profile_id)
  );
$$;

REVOKE ALL ON FUNCTION public.is_project_contributor(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_project_contributor(UUID) TO authenticated;

-- ─── RLS: projects ────────────────────────────────────────────────────

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- A public project is a discovery surface: anyone, signed in or not, reads it.
CREATE POLICY "Public projects are viewable by everyone" ON public.projects
    FOR SELECT TO anon, authenticated USING (is_public);

-- A private one only its owner and its contributors see. To everyone else it
-- does not exist.
CREATE POLICY "Owners and contributors can view private projects" ON public.projects
    FOR SELECT TO authenticated
    USING ((SELECT public.owns_profile(owner_profile_id)) OR public.is_project_contributor(id));

CREATE POLICY "Users can create own projects" ON public.projects
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.owns_profile(owner_profile_id)));

CREATE POLICY "Users can update own projects" ON public.projects
    FOR UPDATE TO authenticated
    USING ((SELECT public.owns_profile(owner_profile_id)))
    WITH CHECK ((SELECT public.owns_profile(owner_profile_id)));

CREATE POLICY "Users can delete own projects" ON public.projects
    FOR DELETE TO authenticated
    USING ((SELECT public.owns_profile(owner_profile_id)));

-- ─── RLS: contributors ────────────────────────────────────────────────
--
-- A link is visible only where its project is (the EXISTS below runs under
-- the caller's own project RLS). A public link, to anyone who can see the
-- project; a hidden one, to the project's owner and that contributor alone.

ALTER TABLE public.contributors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public contributor links are viewable with their project" ON public.contributors
    FOR SELECT TO anon, authenticated
    USING (is_public AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = contributors.project_id));

CREATE POLICY "Owners and the contributor can view hidden links" ON public.contributors
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = contributors.project_id
          AND ((SELECT public.owns_profile(p.owner_profile_id))
               OR (SELECT public.owns_profile(contributors.contributor_profile_id)))
    ));

-- Linking, relinking and unlinking are the project owner's right.
CREATE POLICY "Project owners can link contributors" ON public.contributors
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = contributors.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ));

CREATE POLICY "Project owners can update contributor links" ON public.contributors
    FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = contributors.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = contributors.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ));

CREATE POLICY "Project owners can unlink contributors" ON public.contributors
    FOR DELETE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = contributors.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ));

-- Being Linked to someone else's project is a public claim about you. You can
-- always withdraw it.
CREATE POLICY "Contributors can remove themselves" ON public.contributors
    FOR DELETE TO authenticated
    USING ((SELECT public.owns_profile(contributor_profile_id)));

-- ─── RLS: project_products ────────────────────────────────────────────

ALTER TABLE public.project_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project products are viewable with their project" ON public.project_products
    FOR SELECT TO anon, authenticated
    USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_products.project_id));

CREATE POLICY "Project owners can link products" ON public.project_products
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_products.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ));

-- No update policy: a link has nothing to edit.
CREATE POLICY "Project owners can unlink products" ON public.project_products
    FOR DELETE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_products.project_id AND (SELECT public.owns_profile(p.owner_profile_id))
    ));

-- ═══ tags: the product and project destinations ═══════════════════════

ALTER TABLE public.tags
    ADD COLUMN dest_product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    ADD COLUMN dest_project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE;

-- The destination foreign keys cascade, so deleting a product or a project
-- looks its tags up by it.
CREATE INDEX tags_dest_product_id ON public.tags (dest_product_id) WHERE dest_product_id IS NOT NULL;
CREATE INDEX tags_dest_project_id ON public.tags (dest_project_id) WHERE dest_project_id IS NOT NULL;

-- Exactly one destination, now of every kind. Every existing tag points at a
-- profile, so every existing row satisfies it.
ALTER TABLE public.tags DROP CONSTRAINT tags_one_destination;
ALTER TABLE public.tags ADD CONSTRAINT tags_one_destination
    CHECK (num_nonnulls(dest_profile_id, dest_product_id, dest_project_id) = 1);

COMMENT ON CONSTRAINT tags_one_destination ON public.tags IS
    'Exactly one destination, of the four kinds: a profile (Business or Individual), a product or a project.';

-- Only a destination the same account owns, on insert and on update — the
-- rule profile destinations already had, extended to products and projects.
-- M6's Embedded Tags (ONE-44) still have to relax this for tag_type =
-- 'embedded', which point at other people's products and profiles.
DROP POLICY "Users can create tags to own destinations" ON public.tags;
CREATE POLICY "Users can create tags to own destinations" ON public.tags
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.owns_profile(owner_profile_id))
        AND (tags.dest_profile_id IS NULL OR (SELECT public.owns_profile(tags.dest_profile_id)))
        AND (tags.dest_product_id IS NULL OR EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = tags.dest_product_id AND (SELECT public.owns_profile(p.business_profile_id))
        ))
        AND (tags.dest_project_id IS NULL OR EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = tags.dest_project_id AND (SELECT public.owns_profile(p.owner_profile_id))
        ))
    );

DROP POLICY "Users can update own tags" ON public.tags;
CREATE POLICY "Users can update own tags" ON public.tags
    FOR UPDATE TO authenticated
    USING ((SELECT public.owns_profile(owner_profile_id)))
    WITH CHECK (
        (SELECT public.owns_profile(owner_profile_id))
        AND (tags.dest_profile_id IS NULL OR (SELECT public.owns_profile(tags.dest_profile_id)))
        AND (tags.dest_product_id IS NULL OR EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = tags.dest_product_id AND (SELECT public.owns_profile(p.business_profile_id))
        ))
        AND (tags.dest_project_id IS NULL OR EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = tags.dest_project_id AND (SELECT public.owns_profile(p.owner_profile_id))
        ))
    );

-- A tag's destination is frozen once it exists (ONE-86), and the new
-- destination columns are part of it.
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
    'Freezes a tag''s short_code, destination (profile, product and project columns), type and owner after insert. A new destination kind adds its column here.';

-- ─── resolve_tag, with every destination ──────────────────────────────
--
-- As ONE-30 built it, extended with the product and project columns — each
-- guarded by the tag being active like the rest, so a paused tag still says
-- nothing about where it points. A project destination is returned even when
-- the project is private: the project screen shows a caller who cannot see it
-- that it was not found, and the route never special-cases it (ONE-41).
--
-- CREATE OR REPLACE cannot change a function's result columns, so it is
-- dropped and recreated, and its grants restated.

DROP FUNCTION public.resolve_tag(TEXT);

CREATE FUNCTION public.resolve_tag(p_short_code TEXT)
RETURNS TABLE (
    tag_id UUID,
    active BOOLEAN,
    dest_profile_id UUID,
    dest_profile_username TEXT,
    dest_product_id UUID,
    dest_project_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    CASE WHEN t.active THEN t.id END,
    t.active,
    CASE WHEN t.active THEN t.dest_profile_id END,
    CASE WHEN t.active THEN p.username END,
    CASE WHEN t.active THEN t.dest_product_id END,
    CASE WHEN t.active THEN t.dest_project_id END
  FROM public.tags t
  LEFT JOIN public.profiles p ON p.id = t.dest_profile_id
  WHERE t.short_code = p_short_code;
$$;

-- Resolution must work without an account: a stranger scanning a sticker.
REVOKE ALL ON FUNCTION public.resolve_tag(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tag(TEXT) TO anon, authenticated;
