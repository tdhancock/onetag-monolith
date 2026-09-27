// Uploading post media to Supabase Storage.
//
// Moved out of the old shared service module so features/posts can publish
// without importing it: that module re-exported features/posts, a cycle Metro
// cannot evaluate, and one that crashed the app on boot. This module imports
// nothing but the client and the local-file reader, so anything may use it.

import { supabase } from './supabase.native';
import { readLocalFile } from './localFile';

/**
 * Raised when a post's media could not be turned into a remotely readable URL.
 * Distinct from a generic publish failure so the composer can tell the author
 * the *image* is the problem, not their text.
 */
export class MediaUploadError extends Error {
    constructor(message: string, readonly cause?: unknown) {
        super(message);
        this.name = 'MediaUploadError';
    }
}

/** A URI that only resolves on the device that produced it. */
export const isLocalMediaUri = (uri: string): boolean =>
    uri.startsWith('file://') ||
    uri.startsWith('content://') ||
    uri.startsWith('blob:') ||
    uri.startsWith('data:');

/**
 * Last line of defence before an insert: a device-local URI stored as
 * `image_url` renders for exactly one person and is unfixable afterwards, so
 * fail loudly rather than writing the row.
 */
export function assertRemoteMediaUrl(url: string | null | undefined): void {
    if (url && isLocalMediaUri(url)) {
        throw new MediaUploadError('Your photo could not be uploaded, so the post was not published.');
    }
}

/**
 * The bucket post and OneSnap media live in, under the account's folder:
 * storage RLS requires the auth user id there.
 */
export const POST_MEDIA_BUCKET = 'post-media';

/** A name nothing else in the folder has. */
export const uniqueFileName = (ext: string): string =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

/**
 * Upload a post's local media file (from the picker or the camera) and return
 * its public URL. Reads it with fetch().arrayBuffer(), which works on React
 * Native.
 *
 * One bucket, one path, `<auth user id>/posts/<name>`, and a refused upload
 * throws (ONE-100). It used to try three buckets and three paths and then
 * return the image inline as a data: URL. The insert refused that anyway, so
 * the guesses only turned a clear storage error into a vaguer one later.
 */
export async function uploadMedia(localUri: string, userId: string): Promise<string> {
    const { arrayBuffer, contentType, ext } = await readLocalFile(localUri);
    const filePath = `${userId}/posts/${uniqueFileName(ext)}`;

    const { error } = await supabase.storage
        .from(POST_MEDIA_BUCKET)
        .upload(filePath, arrayBuffer, { cacheControl: '3600', upsert: false, contentType });
    if (error) throw new MediaUploadError("Your photo couldn't be uploaded.", error);

    return supabase.storage.from(POST_MEDIA_BUCKET).getPublicUrl(filePath).data.publicUrl;
}
