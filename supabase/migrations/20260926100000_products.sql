-- Products, their media and their specs (ONE-37).
--
-- A Product is a catalog item listed by a Business Profile: browsable,
-- saveable, linkable from a Project, and one of the four Tag Destinations.
--
-- It is not a thing you can buy. Commerce is permanently out of scope, so
-- there is no purchase type, no affiliate rate and no stock count here —
-- columns added "for later" invite a later ticket to wire them up. A price is
-- display information only: a null price means "not shown", never "ask for a
-- quote".
--
-- Product images live in the existing `post-media` bucket under a
-- `products/<auth user id>/…` prefix. That bucket's upload policy accepts a
-- path whose first or second folder is the uploader's auth.uid(), so the path
-- must be keyed by the account, never the business profile's id — a profile
-- id differs from its account's id for every profile made after signup.
--
-- Additive: nothing reads these tables until the product screens (ONE-40).

-- ─── updated_at ───────────────────────────────────────────────────────
--
-- Stamped by the database on every update, so no client can forget it or
-- backdate it. Shared by the M5 tables that carry one.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ─── products ─────────────────────────────────────────────────────────

CREATE TABLE public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    description TEXT,
    category TEXT,
    -- Display only. Null means no price is shown.
    price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
    -- A bare integer with no currency is a bug waiting to happen, even for
    -- display. ISO 4217: three capital letters.
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    available BOOLEAN NOT NULL DEFAULT true,
    sku TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Groundwork for search across content types (M6, ONE-48), added while
    -- the table is empty rather than retrofitted. The name outweighs the
    -- description when ranking.
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english'::regconfig, coalesce(name, '')), 'A')
        || setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'B')
    ) STORED
);

CREATE INDEX products_business_profile_id_created_at ON public.products (business_profile_id, created_at DESC);
CREATE INDEX products_category ON public.products (category);
CREATE INDEX products_search_vector ON public.products USING GIN (search_vector);

CREATE TRIGGER products_set_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Only a business profile lists products ───────────────────────────
--
-- The same guard business_profiles uses (ONE-23). A profile's type is frozen
-- once it exists (ONE-79), so checking on insert, and on any update that
-- moves the product to another profile, is enough.

CREATE OR REPLACE FUNCTION public.products_require_business()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.business_profile_id AND profile_type = 'business'
  ) THEN
    RAISE EXCEPTION 'only a business profile can list a product'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_require_business
    BEFORE INSERT OR UPDATE OF business_profile_id ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.products_require_business();

-- ─── product_media and product_specs ──────────────────────────────────

CREATE TABLE public.product_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo', 'video')),
    -- The first by sort_order is the product's representative image.
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX product_media_product_id_sort_order ON public.product_media (product_id, sort_order);

CREATE TABLE public.product_specs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    value TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX product_specs_product_id_sort_order ON public.product_specs (product_id, sort_order);

-- ─── RLS ──────────────────────────────────────────────────────────────
--
-- Readable by everyone, signed in or not: a product is a public discovery
-- surface, and a scanned Tag resolves to one for someone without the app.
-- Writes belong to the account owning the business profile, through the
-- ownership helper — on the product itself, or on the product a media or
-- spec row belongs to.

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_specs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Products are viewable by everyone" ON public.products
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Businesses can create own products" ON public.products
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.owns_profile(business_profile_id)));

CREATE POLICY "Businesses can update own products" ON public.products
    FOR UPDATE TO authenticated
    USING ((SELECT public.owns_profile(business_profile_id)))
    WITH CHECK ((SELECT public.owns_profile(business_profile_id)));

CREATE POLICY "Businesses can delete own products" ON public.products
    FOR DELETE TO authenticated
    USING ((SELECT public.owns_profile(business_profile_id)));

CREATE POLICY "Product media is viewable by everyone" ON public.product_media
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Businesses can create media on own products" ON public.product_media
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_media.product_id AND (SELECT public.owns_profile(p.business_profile_id))
    ));

CREATE POLICY "Businesses can update media on own products" ON public.product_media
    FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_media.product_id AND (SELECT public.owns_profile(p.business_profile_id))
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_media.product_id AND (SELECT public.owns_profile(p.business_profile_id))
    ));

CREATE POLICY "Businesses can delete media on own products" ON public.product_media
    FOR DELETE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_media.product_id AND (SELECT public.owns_profile(p.business_profile_id))
    ));

CREATE POLICY "Product specs are viewable by everyone" ON public.product_specs
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Businesses can create specs on own products" ON public.product_specs
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_specs.product_id AND (SELECT public.owns_profile(p.business_profile_id))
    ));

CREATE POLICY "Businesses can update specs on own products" ON public.product_specs
    FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_specs.product_id AND (SELECT public.owns_profile(p.business_profile_id))
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_specs.product_id AND (SELECT public.owns_profile(p.business_profile_id))
    ));

CREATE POLICY "Businesses can delete specs on own products" ON public.product_specs
    FOR DELETE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = product_specs.product_id AND (SELECT public.owns_profile(p.business_profile_id))
    ));
