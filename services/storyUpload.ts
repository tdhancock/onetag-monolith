// OneSnap media upload.
//
// Moved out of the old shared service module with the stories migration
// (ONE-19), next to services/mediaUpload.ts, which handles post media.
//
// One bucket, one path, `<auth user id>/stories/<name>`, and a refused upload
// throws (ONE-100). It used to try four buckets and five paths, and the caller
// then stored the photo inline in the row as a data: URL, or swapped it for a
// picture of the caption. A OneSnap either has its photo in storage, or it
// isn't published.
//
// Storage paths are keyed by the auth user id: storage RLS gates on
// `auth.uid()` appearing in the folder name.

import { supabase } from './supabase.native';
import { MediaUploadError, POST_MEDIA_BUCKET, uniqueFileName } from './mediaUpload';

/** A local file URI as a Blob with a content type, ready to upload. */
export const uriToUploadBlob = async (uri: string): Promise<Blob> => {
    const response = await fetch(uri);
    const blob = await response.blob();
    return blob.type ? blob : new Blob([blob], { type: 'image/jpeg' });
};

const toStorageExtension = (mimeType: string | undefined, fallback: string = 'bin'): string => {
    if (!mimeType) return fallback;
    const normalized = mimeType.toLowerCase();
    if (normalized.includes('jpeg')) return 'jpg';
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('gif')) return 'gif';
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('mp4')) return 'mp4';
    if (normalized.includes('quicktime')) return 'mov';
    if (normalized.includes('plain')) return 'txt';

    const raw = normalized.split('/')[1] || fallback;
    const cleaned = raw.replace(/[^a-z0-9]/g, '');
    return cleaned.length > 0 ? cleaned : fallback;
};

/** Upload a OneSnap's photo and return its public URL. */
export const uploadStoryMedia = async (file: Blob | File, userId: string): Promise<string> => {
    const filePath = `${userId}/stories/${uniqueFileName(toStorageExtension(file.type, 'jpg'))}`;

    const { error } = await supabase.storage
        .from(POST_MEDIA_BUCKET)
        .upload(filePath, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
    if (error) throw new MediaUploadError("Your OneSnap's photo couldn't be uploaded.", error);

    return supabase.storage.from(POST_MEDIA_BUCKET).getPublicUrl(filePath).data.publicUrl;
};
