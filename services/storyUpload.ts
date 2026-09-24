// Story media upload.
//
// Moved out of the old shared service module with the stories migration (ONE-19),
// next to services/mediaUpload.ts, which handles post media. A story tries a
// wider set of buckets and paths than a post, and falls back to an inline
// data URL rather than failing, so it keeps its own helpers.
//
// Storage paths are keyed by the auth user id: storage RLS gates on
// `auth.uid()` appearing in the folder name.

import { supabase } from './supabase.native';
import { isLikelyStoragePolicyError, isStorageBucketMissingError } from './mediaUpload';

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

export const uploadStoryMedia = async (
    file: Blob | File,
    userId: string,
): Promise<{ bucket: string; filePath: string }> => {
    const fallbackExtension = 'jpg';
    const extension = toStorageExtension(file.type, fallbackExtension);
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const bucketCandidates = ['post-media', 'avatars', 'stories', 'story-media'];
    const filePathCandidates = [
        `${userId}/stories/${fileName}`,
        `stories/${userId}/${fileName}`,
        `${userId}/${fileName}`,
        `${userId}/posts/${fileName}`,
        `public/${userId}/${fileName}`,
    ];

    let lastError: unknown = null;

    for (const bucket of bucketCandidates) {
        for (const filePath of filePathCandidates) {
            const { error } = await supabase.storage
                .from(bucket)
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: false,
                    contentType: file.type || undefined,
                });

            if (!error) {
                return { bucket, filePath };
            }

            lastError = error;
            if (!isLikelyStoragePolicyError(error) && !isStorageBucketMissingError(error)) {
                throw error;
            }
        }
    }

    throw lastError || new Error('Story storage upload failed.');
};

export const blobToDataUrl = async (blob: Blob): Promise<string> => {
    if (typeof FileReader === 'undefined') {
        throw new Error('FileReader is not available');
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('Could not convert blob to data URL'));
            }
        };
        reader.onerror = () => reject(reader.error || new Error('FileReader error'));
        reader.readAsDataURL(blob);
    });
};

export const buildTextStoryDataUri = (text: string): string => {
    const normalized = (text || '').trim() || 'Story';
    const escaped = normalized
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1e3a5f"/><stop offset="100%" stop-color="#0f172a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/><foreignObject x="88" y="220" width="904" height="1480"><div xmlns="http://www.w3.org/1999/xhtml" style="color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:54px;line-height:1.35;font-weight:700;white-space:pre-wrap;word-break:break-word;">${escaped}</div></foreignObject></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};
