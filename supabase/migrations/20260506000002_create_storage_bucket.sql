-- Migration: storage buckets for post/story media and avatars
--
-- RULE (ONE-21): media upload paths are keyed by the AUTH USER id, never by a
-- profile id. Every policy below gates on (SELECT auth.uid()) appearing in the
-- folder name. Since the multi-profile migration a profile id can differ from
-- its account's auth id, so an upload pathed by profile id is rejected here --
-- a failure that surfaces far from its cause. Do not route these policies
-- through public.owns_profile(); build paths from the auth user id instead
-- (services/mediaUpload.ts, services/storyUpload.ts, features/profiles uploadAvatar).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('post-media', 'post-media', true, 52428800, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime']),
  ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- post-media: upload paths used by the app are `<uid>/...`, `posts|stories/<uid>/...`, `public/<uid>/...`
CREATE POLICY "Authenticated users can upload media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'post-media'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR (storage.foldername(name))[2] = (SELECT auth.uid())::text
  )
);

CREATE POLICY "Public read access for post-media"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'post-media');

CREATE POLICY "Users can delete own uploads"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'post-media' AND owner = (SELECT auth.uid()));

-- avatars: app uploads to `avatars/<uid>/<timestamp>` with upsert
CREATE POLICY "Users can upload own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[2] = (SELECT auth.uid())::text);

CREATE POLICY "Users can update own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[2] = (SELECT auth.uid())::text)
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[2] = (SELECT auth.uid())::text);

CREATE POLICY "Public read access for avatars"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');

CREATE POLICY "Users can delete own avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[2] = (SELECT auth.uid())::text);
