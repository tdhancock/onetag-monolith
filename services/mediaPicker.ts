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
