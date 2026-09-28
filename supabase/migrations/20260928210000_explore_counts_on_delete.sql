-- Deleting an account no longer trips the Explore totals (ONE-104).
--
-- explore_scores_count() moves an item's like, comment, repost and save
-- totals as those rows come and go. When one statement deletes a post and,
-- separately, two or more of its likes and comments, the second update to
-- the post's explore_scores row makes Postgres re-check that row's foreign
-- key. The post is already gone, so the whole delete failed. Deleting an
-- account does exactly that when it holds a Business and an Individual
-- profile and one liked and commented on the other's post: the account
-- couldn't be deleted at all.
--
-- A total now moves only while its post, product or project is still there.
-- When it isn't, its explore_scores row is going too, by cascade.

CREATE OR REPLACE FUNCTION public.explore_scores_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r RECORD;
  d INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; d := -1; ELSE r := NEW; d := 1; END IF;

  IF TG_TABLE_NAME = 'likes' THEN
    UPDATE public.explore_scores SET likes = greatest(likes + d, 0)
    WHERE post_id = r.post_id AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = r.post_id);
  ELSIF TG_TABLE_NAME = 'comments' THEN
    UPDATE public.explore_scores SET comments = greatest(comments + d, 0)
    WHERE post_id = r.post_id AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = r.post_id);
  ELSIF TG_TABLE_NAME = 'reposts' THEN
    UPDATE public.explore_scores SET reposts = greatest(reposts + d, 0)
    WHERE post_id = r.post_id AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = r.post_id);
  ELSIF r.saved_post_id IS NOT NULL THEN
    UPDATE public.explore_scores SET saves = greatest(saves + d, 0)
    WHERE post_id = r.saved_post_id AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = r.saved_post_id);
  ELSIF r.saved_product_id IS NOT NULL THEN
    UPDATE public.explore_scores SET saves = greatest(saves + d, 0)
    WHERE product_id = r.saved_product_id AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = r.saved_product_id);
  ELSIF r.saved_project_id IS NOT NULL THEN
    UPDATE public.explore_scores SET saves = greatest(saves + d, 0)
    WHERE project_id = r.saved_project_id AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = r.saved_project_id);
  END IF;
  -- A saved profile isn't in Explore; nothing to move.
  RETURN NULL;
END;
$$;
