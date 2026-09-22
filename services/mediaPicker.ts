//
// Shared `expo-image-picker` wrapper for the post media flow.
//
// The camera tab and the composer both need "pick a photo from the library"
// and "take a photo", with the same options and the same cancel/permission
// handling. Before this existed each screen inlined its own call; the flows
// drifted apart on quality, editing and media types. Both now call through
// here.
//
// `app/story-create.tsx` and `app/edit-profile.tsx` still hold their own
// copies — consolidating those is deliberately out of scope (ONE-57), but
// nothing new should add a fifth.
//
// Images only. `expo-image-picker` is restricted to `['images']` here on
// purpose: enabling video is a separate decision with storage and playback
// consequences, and `posts.media_type` cannot express it today.

import * as ImagePicker from 'expo-image-picker';
import type { Post } from '../types';

/**
 * A photo the user chose, with the dimensions the picker reported.
 *
 * `width`/`height` come straight from the source asset. They are carried so
 * the aspect ratio can be measured once, at the point of capture, rather than
 * re-derived from a rendered view further down — see ONE-55, which persists
 * it as `posts.media_aspect_ratio`.
 */
export interface PickedMedia {
  uri: string;
  width: number | null;
  height: number | null;
  mediaType: 'image';
}

/**
 * Outcome of a pick. `canceled` and `permission-denied` are distinct because
 * a dismissal is silent and a denial needs telling the user why nothing
 * happened.
 */
export type MediaPickerResult =
  | { status: 'selected'; media: PickedMedia }
  | { status: 'canceled' }
  | { status: 'permission-denied' };

/** Options shared by both entry points. Callers may override per call. */
const POST_MEDIA_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.9,
  allowsEditing: true,
};

const CANCELED: MediaPickerResult = { status: 'canceled' };

function toResult(result: ImagePicker.ImagePickerResult): MediaPickerResult {
  if (result.canceled) return CANCELED;

  const asset = result.assets?.[0];
  if (!asset?.uri) return CANCELED;

  return {
    status: 'selected',
    media: {
      uri: asset.uri,
      width: asset.width ?? null,
      height: asset.height ?? null,
      mediaType: 'image',
    },
  };
}

/**
 * Open the photo library. Resolves to `canceled` when the user dismisses it.
 */
export async function pickImageFromLibrary(
  options: ImagePicker.ImagePickerOptions = {},
): Promise<MediaPickerResult> {
  const result = await ImagePicker.launchImageLibraryAsync({
    ...POST_MEDIA_OPTIONS,
    ...options,
  });

  return toResult(result);
}

/**
 * Open the system camera. Requests camera permission first and reports
 * `permission-denied` rather than opening a camera that cannot see anything.
 *
 * The camera *tab* does not use this — it renders its own `CameraView` and
 * captures through `takePictureAsync`. This is for screens that only need a
 * one-shot capture, such as the composer.
 */
export async function captureImageWithCamera(
  options: ImagePicker.ImagePickerOptions = {},
): Promise<MediaPickerResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { status: 'permission-denied' };

  const result = await ImagePicker.launchCameraAsync({
    ...POST_MEDIA_OPTIONS,
    ...options,
  });

  return toResult(result);
}

// ---------------------------------------------------------------------------
// Transforms into and out of PickedMedia
// ---------------------------------------------------------------------------
//
// These live here, beside the type they convert, rather than in a
// `app/compose.utils.ts` sidecar: expo-router registers every file under
// `app/` as a route, so a helper module there becomes a navigable route with
// no default export and warns about it on every boot.

/**
 * Seed an attachment from the route params the camera tab pushes.
 *
 * `mediaType` is honoured rather than ignored: the composer is images-only,
 * so a param claiming anything else is dropped instead of being published
 * under `media_type: 'image'`. Before ONE-57 it was read and never used,
 * which would have mislabeled the first video the moment video was enabled.
 *
 * Dimensions are unknown on this path — the camera tab passes only the URI.
 */
export function attachmentFromParams(
  uri?: string,
  mediaType?: string,
  width?: string,
  height?: string,
): PickedMedia | null {
  if (!uri) return null;
  if (mediaType && mediaType !== 'image') return null;

  return {
    uri,
    width: parseDimension(width),
    height: parseDimension(height),
    mediaType: 'image',
  };
}

/** Route params arrive as strings. Anything not a positive number is unknown. */
function parseDimension(value?: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The `media` / `media_type` pair a published Post carries for a given
 * attachment. Derived from the attachment itself rather than from the
 * presence of a route param, so removing an attachment genuinely publishes
 * a text post.
 */
export function buildPostMedia(attachment: PickedMedia | null): {
  media: string | undefined;
  media_type: Post['media_type'];
  media_aspect_ratio: number | null;
} {
  if (!attachment) return { media: undefined, media_type: 'text', media_aspect_ratio: null };

  return {
    media: attachment.uri,
    media_type: attachment.mediaType,
    media_aspect_ratio: mediaAspectRatio(attachment),
  };
}

// ---------------------------------------------------------------------------
// Aspect ratio
// ---------------------------------------------------------------------------

/**
 * The widest and tallest framings a post may claim, as width / height.
 *
 * 0.5 is 1:2 and 1.91 is the landscape limit the major feeds settled on. A
 * panorama at 5:1 or a full-page screenshot at 1:4 is allowed to be attached,
 * but it is stored clamped and rendered letterboxed inside that box
 * (`contentFit="contain"`), because a row tall or wide enough to hold it
 * wrecks the feed around it. Nothing is ever distorted to fit.
 */
export const MIN_ASPECT_RATIO = 0.5;
export const MAX_ASPECT_RATIO = 1.91;

/**
 * The ratio to persist as `posts.media_aspect_ratio`, measured once from the
 * dimensions the source reported — never re-derived from a rendered view,
 * which is the bug ONE-55 fixed one layer up.
 *
 * `null` when the source gave no usable dimensions; `PostCard` then falls back
 * to 4:5, which is also what every row written before ONE-55 holds.
 */
export function mediaAspectRatio(media: PickedMedia | null): number | null {
  if (!media?.width || !media?.height) return null;
  if (media.width <= 0 || media.height <= 0) return null;

  return clampAspectRatio(media.width / media.height);
}

/** Confine a ratio to the publishable range. */
export function clampAspectRatio(ratio: number): number {
  return Math.min(MAX_ASPECT_RATIO, Math.max(MIN_ASPECT_RATIO, ratio));
}
