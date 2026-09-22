//
// Pure logic extracted from app/compose.tsx (ComposeScreen) so the media
// attachment rules — seeding an attachment from route params, and deriving
// what the published Post carries — can be exercised in tests without
// spinning up React Native, expo-router, or the AppContext provider.
//
// Sidecar convention, matching app/(tabs)/feed.utils.ts and friends.

import type { PickedMedia } from '../services/mediaPicker';
import type { Post } from '../types';

/**
 * Seed the attachment from the route params the camera tab pushes.
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
): PickedMedia | null {
  if (!uri) return null;
  if (mediaType && mediaType !== 'image') return null;

  return { uri, width: null, height: null, mediaType: 'image' };
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
} {
  if (!attachment) return { media: undefined, media_type: 'text' };

  return { media: attachment.uri, media_type: attachment.mediaType };
}
