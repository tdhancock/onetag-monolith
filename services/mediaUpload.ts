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
 * Upload a local media file (from expo-image-picker or camera) to Supabase Storage.
 * Uses fetch().arrayBuffer() which works reliably on React Native.
 * Returns the public URL of the uploaded file.
 */
export async function uploadMedia(localUri: string, userId: string): Promise<string> {
    const { arrayBuffer, contentType, ext } = await readLocalFile(localUri);

    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    // Try uploading to the 'post-media' bucket first (same bucket the web app uses)
    const candidatePaths = [
        `${userId}/posts/${fileName}`,
        `posts/${userId}/${fileName}`,
        `public/${userId}/${fileName}`,
    ];

    const bucketCandidates = ['post-media', 'media', 'uploads'];

    let lastError: unknown = null;

    for (const bucket of bucketCandidates) {
        for (const filePath of candidatePaths) {
            const { error } = await supabase.storage
                .from(bucket)
                .upload(filePath, arrayBuffer, {
                    cacheControl: '3600',
                    upsert: false,
                    contentType,
                });

            if (!error) {
                const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
                return data.publicUrl;
            }

            lastError = error;
            // If it's not a policy/bucket error, throw immediately
            if (!isLikelyStoragePolicyError(error) && !isStorageBucketMissingError(error)) {
                throw error;
            }
            // If it's a bucket-missing error for this bucket, try next bucket
            if (isStorageBucketMissingError(error)) {
                break; // skip remaining paths for this bucket, try next bucket
            }
        }
    }

    // All buckets failed — fall back to data URL
    console.warn('All storage buckets unavailable, falling back to data URL.');
    return arrayBufferToDataUrl(arrayBuffer, contentType);
}

/**
 * Convert ArrayBuffer to base64 data URL — fallback when storage is unavailable.
 */
function arrayBufferToDataUrl(buffer: ArrayBuffer, contentType: string): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:${contentType};base64,${base64}`;
}

export const isLikelyStoragePolicyError = (error: unknown): boolean => {
    const message = String((error as { message?: unknown })?.message || error).toLowerCase();
    return (
        message.includes('row-level security policy') ||
        message.includes('not authorized') ||
        message.includes('permission denied')
    );
};

export const isStorageBucketMissingError = (error: unknown): boolean => {
    const message = String((error as { message?: unknown })?.message || error).toLowerCase();
    return message.includes('bucket') && message.includes('not found');
};
