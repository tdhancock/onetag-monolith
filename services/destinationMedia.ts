// Uploading a Product's or a Project's images (ONE-40, ONE-41).
//
// Into the `post-media` bucket, under `products/<auth user id>/…` or
// `projects/<auth user id>/…`. The bucket's upload policy accepts a path whose
// first or second folder is the uploader's auth.uid(), so the second folder
// here is the account's id — never a profile id, which differs from its
// account's for every profile made after signup (ONE-21). A product belongs to
// a business profile, but its images are filed under the account that owns it.
//
// One bucket, one path, and no fallback. The post uploader tries several and
// falls back to an inline data: URL; a product image stored that way would
// render on this device and nowhere else. A failure here throws, and the
// caller writes nothing.

import { supabase } from './supabase.native';
import { readLocalFile } from './localFile';
import { MediaUploadError, isLocalMediaUri } from './mediaUpload';
import type { AuthUserId } from '../types';

export const DESTINATION_MEDIA_BUCKET = 'post-media';

/** Where each kind of Destination keeps its images. */
export type DestinationMediaFolder = 'products' | 'projects';

/** An image's storage path: the folder, then the account, then a name nothing else has. */
export const destinationMediaPath = (
  folder: DestinationMediaFolder,
  authUserId: AuthUserId,
  ext: string,
  unique: string = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
): string => `${folder}/${authUserId}/${unique}.${ext}`;

/** Upload one image from the device and return its public URL. */
export async function uploadDestinationImage(
  localUri: string,
  authUserId: AuthUserId,
  folder: DestinationMediaFolder,
): Promise<string> {
  let file: Awaited<ReturnType<typeof readLocalFile>>;
  try {
    file = await readLocalFile(localUri);
  } catch (error) {
    throw new MediaUploadError("A photo couldn't be read from this device.", error);
  }

  const path = destinationMediaPath(folder, authUserId, file.ext);
  const { error } = await supabase.storage
    .from(DESTINATION_MEDIA_BUCKET)
    .upload(path, file.arrayBuffer, { cacheControl: '3600', upsert: false, contentType: file.contentType });
  if (error) throw new MediaUploadError("A photo couldn't be uploaded.", error);

  return supabase.storage.from(DESTINATION_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Every image as a URL anyone can load: the ones still on the device
 * uploaded, the ones already stored left as they are. Order is kept, since
 * the first image is the representative one.
 */
export const uploadDeviceImages = (
  uris: string[],
  authUserId: AuthUserId,
  folder: DestinationMediaFolder,
): Promise<string[]> =>
  Promise.all(uris.map((uri) => (isLocalMediaUri(uri) ? uploadDestinationImage(uri, authUserId, folder) : uri)));
