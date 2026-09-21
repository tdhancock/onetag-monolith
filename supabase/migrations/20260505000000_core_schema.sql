-- OneTag — core schema (baseline)
-- Derived from the queries in services/apiService.ts, store/AppContext.native.tsx
-- and the realtime subscriptions in app/ and components/.
-- Must run before 20260506000001_add_missing_tables.sql (which references profiles).

-- ═══════════════════════════════════════
-- profiles
-- ═══════════════════════════════════════
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT NOT NULL CHECK (char_length(username) BETWEEN 3 AND 20),
    full_name TEXT,
    bio TEXT DEFAULT 'Hello, I am using OneTag',
    avatar_url TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    is_private BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX profiles_username_lower_key ON public.profiles (lower(username));

-- ═══════════════════════════════════════
-- posts and post interactions
-- ═══════════════════════════════════════
CREATE TABLE public.posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    media_type TEXT NOT NULL DEFAULT 'text' CHECK (media_type IN ('text', 'image')),
    media_aspect_ratio NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_posts_user_created ON public.posts (user_id, created_at DESC);
CREATE INDEX idx_posts_created ON public.posts (created_at DESC);

CREATE TABLE public.likes (
    post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);
CREATE INDEX idx_likes_user ON public.likes (user_id);

CREATE TABLE public.reposts (
    post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);
CREATE INDEX idx_reposts_user ON public.reposts (user_id, created_at DESC);

CREATE TABLE public.saved_posts (
    post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);
CREATE INDEX idx_saved_posts_user ON public.saved_posts (user_id, created_at DESC);

CREATE TABLE public.comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_post ON public.comments (post_id, created_at DESC);
CREATE INDEX idx_comments_user ON public.comments (user_id);

CREATE TABLE public.comment_likes (
    comment_id UUID NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX idx_comment_likes_user ON public.comment_likes (user_id);

-- ═══════════════════════════════════════
-- follows
-- ═══════════════════════════════════════
CREATE TABLE public.follows (
    follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    followed_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followed_id),
    CHECK (follower_id <> followed_id)
);
CREATE INDEX idx_follows_followed ON public.follows (followed_id);

-- ═══════════════════════════════════════
-- stories
-- ═══════════════════════════════════════
CREATE TABLE public.stories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    media_url TEXT NOT NULL,
    caption TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stories_user_created ON public.stories (user_id, created_at DESC);

CREATE TABLE public.story_likes (
    story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (story_id, user_id)
);

CREATE TABLE public.story_views (
    story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (story_id, user_id)
);

-- ═══════════════════════════════════════
-- notifications (FK names are referenced by the app's embedded selects)
-- ═══════════════════════════════════════
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL,
    receiver_id UUID NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('like', 'comment', 'follow', 'comment_like', 'repost', 'mention', 'story_like')),
    post_id UUID,
    comment_id UUID,
    story_id UUID,
    content TEXT,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT notifications_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT notifications_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT notifications_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE,
    CONSTRAINT notifications_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.comments(id) ON DELETE CASCADE,
    CONSTRAINT notifications_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.stories(id) ON DELETE CASCADE
);
CREATE INDEX idx_notifications_receiver ON public.notifications (receiver_id, created_at DESC);

-- ═══════════════════════════════════════
-- messages
-- ═══════════════════════════════════════
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    text TEXT,
    type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'profile_share', 'post_share', 'story_reply')),
    shared_post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
    shared_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    replied_story_id UUID REFERENCES public.stories(id) ON DELETE SET NULL,
    reply_to UUID REFERENCES public.messages(id) ON DELETE SET NULL,
    seen BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_sender ON public.messages (sender_id, created_at DESC);
CREATE INDEX idx_messages_receiver ON public.messages (receiver_id, created_at DESC);

-- ═══════════════════════════════════════
-- Auto-create a profile for every new auth user
-- ═══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
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

  INSERT INTO public.profiles (id, username, full_name, avatar_url)
  VALUES (
    NEW.id,
    candidate,
    coalesce(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(coalesce(NEW.email, ''), '@', 1), 'OneTag User'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Users must not be able to verify themselves. Only service_role / postgres may change is_verified.
CREATE OR REPLACE FUNCTION public.protect_profile_verified()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_verified IS DISTINCT FROM OLD.is_verified
     AND coalesce(auth.role(), 'service_role') NOT IN ('service_role', 'supabase_admin')
     AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'is_verified can only be changed by an administrator';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_protect_verified
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_verified();

-- ═══════════════════════════════════════
-- Row Level Security
-- ═══════════════════════════════════════
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reposts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- profiles: readable by everyone (signup checks username availability before login)
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles
    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Users can insert own profile" ON public.profiles
    FOR INSERT TO authenticated WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE TO authenticated USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));

-- posts
CREATE POLICY "Posts are viewable by authenticated users" ON public.posts
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create own posts" ON public.posts
    FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can update own posts" ON public.posts
    FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can delete own posts" ON public.posts
    FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- likes / reposts / comment_likes / story_likes: public counts, own writes
CREATE POLICY "Likes are viewable" ON public.likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can like as themselves" ON public.likes FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can remove own likes" ON public.likes FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Reposts are viewable" ON public.reposts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can repost as themselves" ON public.reposts FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can remove own reposts" ON public.reposts FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Comment likes are viewable" ON public.comment_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can like comments as themselves" ON public.comment_likes FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can remove own comment likes" ON public.comment_likes FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Story likes are viewable" ON public.story_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can like stories as themselves" ON public.story_likes FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can remove own story likes" ON public.story_likes FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- saved_posts: private to the saver
CREATE POLICY "Users can view own saved posts" ON public.saved_posts FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can save posts as themselves" ON public.saved_posts FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can unsave own posts" ON public.saved_posts FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- comments
CREATE POLICY "Comments are viewable" ON public.comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can comment as themselves" ON public.comments FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can update own comments" ON public.comments FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can delete own comments" ON public.comments FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- follows
CREATE POLICY "Follows are viewable" ON public.follows FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can follow as themselves" ON public.follows FOR INSERT TO authenticated WITH CHECK (follower_id = (SELECT auth.uid()));
CREATE POLICY "Users can unfollow" ON public.follows FOR DELETE TO authenticated USING (follower_id = (SELECT auth.uid()));

-- stories: visible to the owner and to their followers
CREATE POLICY "Stories visible to owner and followers" ON public.stories
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = (SELECT auth.uid()) AND f.followed_id = stories.user_id
        )
    );
CREATE POLICY "Users can create own stories" ON public.stories FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can delete own stories" ON public.stories FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- story_views: viewer sees own rows, story owner sees who viewed
CREATE POLICY "Viewers and owners can see story views" ON public.story_views
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.stories s WHERE s.id = story_views.story_id AND s.user_id = (SELECT auth.uid()))
    );
CREATE POLICY "Users can record own story views" ON public.story_views FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can update own story views" ON public.story_views FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- notifications
CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT TO authenticated USING (receiver_id = (SELECT auth.uid()));
CREATE POLICY "Users can send notifications as themselves" ON public.notifications FOR INSERT TO authenticated WITH CHECK (sender_id = (SELECT auth.uid()));
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE TO authenticated USING (receiver_id = (SELECT auth.uid())) WITH CHECK (receiver_id = (SELECT auth.uid()));
CREATE POLICY "Users can delete own notifications" ON public.notifications FOR DELETE TO authenticated USING (receiver_id = (SELECT auth.uid()));

-- messages
CREATE POLICY "Users can view own messages" ON public.messages
    FOR SELECT TO authenticated
    USING (sender_id = (SELECT auth.uid()) OR receiver_id = (SELECT auth.uid()));
CREATE POLICY "Users can send messages as themselves" ON public.messages
    FOR INSERT TO authenticated WITH CHECK (sender_id = (SELECT auth.uid()));
CREATE POLICY "Receivers can mark messages seen" ON public.messages
    FOR UPDATE TO authenticated USING (receiver_id = (SELECT auth.uid())) WITH CHECK (receiver_id = (SELECT auth.uid()));
CREATE POLICY "Participants can delete messages" ON public.messages
    FOR DELETE TO authenticated
    USING (sender_id = (SELECT auth.uid()) OR receiver_id = (SELECT auth.uid()));

-- ═══════════════════════════════════════
-- Realtime (tables the app subscribes to)
-- ═══════════════════════════════════════
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.follows REPLICA IDENTITY FULL;
ALTER TABLE public.posts REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE
    public.messages, public.follows, public.posts, public.stories, public.notifications;
