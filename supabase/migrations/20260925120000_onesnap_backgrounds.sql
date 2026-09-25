-- Text OneSnaps keep the background their author chose (ONE-78).
--
-- A text OneSnap has no media, but `stories.media_url` was NOT NULL. So the
-- client's first insert of one always failed, and it retried with an SVG data
-- URI standing in for the text: a fixed navy gradient with the words inside a
-- <foreignObject>, which the native image renderers do not draw. The gradient
-- picked on the create screen was never stored anywhere.
--
-- After this, a text OneSnap is a row with no media: its words in `caption`,
-- its gradient in `background`, and the app draws both natively.
--
-- Safe for app builds that predate it: they already insert a text OneSnap
-- with a null `media_url` first, which now simply succeeds, and they already
-- draw a OneSnap without media as text on a gradient.

-- ─── media_url becomes optional ────────────────────────────────────────

ALTER TABLE public.stories ALTER COLUMN media_url DROP NOT NULL;

-- Optional media, but never an empty OneSnap: it shows either media or words.
-- Every existing row has media, so this validates without a backfill. Stories
-- expire after 24 hours and the table is small, so the one-off scan is cheap.
ALTER TABLE public.stories
    ADD CONSTRAINT stories_has_content
    CHECK (media_url IS NOT NULL OR nullif(btrim(caption), '') IS NOT NULL);

-- ─── background ────────────────────────────────────────────────────────

-- A key into the app's `oneSnapGradients` token set (theme/tokens.ts), such as
-- 'navy'. A key rather than a position, so adding or reordering gradients never
-- repaints an existing OneSnap. The set is deliberately not enumerated here:
-- an app that does not recognise a key falls back to a gradient of its own
-- choosing, so the check only keeps the value key-shaped.
--
-- Null for image OneSnaps, and for text OneSnaps posted before this existed.
ALTER TABLE public.stories ADD COLUMN background TEXT;

ALTER TABLE public.stories
    ADD CONSTRAINT stories_background_key
    CHECK (background IS NULL OR background ~ '^[a-z][a-z0-9-]{0,31}$');
