//
// target: services/mediaPicker.ts (the compose-side transforms)
//
// The composer's media attachment rules (ONE-57). Covers the four
// behaviours the ticket asks for:
//
//   1. Attaching sets media on the published post.
//   2. Removing clears it, and the post publishes as text.
//   3. The route-param path from the camera tab still populates the
//      attachment exactly as it did before.
//   4. The poll and media paths do not interfere — the media fields are
//      derived from the attachment alone.

// The transforms under test are pure, but they live beside the picker
// wrapper, so the native module has to be stubbed for the import to resolve.
jest.mock('expo-image-picker', () => require('./support/expoImagePickerStub'), {
  virtual: true,
});

import {
  attachmentFromParams,
  buildPostMedia,
  type PickedMedia,
} from '../services/mediaPicker';

const picked = (overrides: Partial<PickedMedia> = {}): PickedMedia => ({
  uri: 'file:///tmp/photo.jpg',
  width: 1920,
  height: 1080,
  mediaType: 'image',
  ...overrides,
});

// ---------------------------------------------------------------------------
// 1. The route-param path (arriving from the camera tab)
// ---------------------------------------------------------------------------

describe('attachmentFromParams', () => {
  it('adopts a mediaUri pushed by the camera tab', () => {
    expect(attachmentFromParams('file:///tmp/from-camera.jpg', 'image')).toEqual({
      uri: 'file:///tmp/from-camera.jpg',
      width: null,
      height: null,
      mediaType: 'image',
    });
  });

  it('adopts a bare mediaUri with no mediaType param', () => {
    const attachment = attachmentFromParams('file:///tmp/bare.jpg');

    expect(attachment?.uri).toBe('file:///tmp/bare.jpg');
    expect(attachment?.mediaType).toBe('image');
  });

  it('opens with no attachment when the composer is entered directly', () => {
    expect(attachmentFromParams(undefined, undefined)).toBeNull();
    expect(attachmentFromParams('')).toBeNull();
  });

  it('drops a param claiming a media type the composer cannot publish', () => {
    // The decoy this replaced would have published this as an image.
    expect(attachmentFromParams('file:///tmp/clip.mp4', 'video')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. What the published post carries
// ---------------------------------------------------------------------------

describe('buildPostMedia', () => {
  it('sets media and media_type from an attachment', () => {
    expect(buildPostMedia(picked())).toEqual({
      media: 'file:///tmp/photo.jpg',
      media_type: 'image',
    });
  });

  it('publishes a text post once the attachment is removed', () => {
    expect(buildPostMedia(null)).toEqual({
      media: undefined,
      media_type: 'text',
    });
  });

  it('derives media_type from the attachment, not from a stale route param', () => {
    // Removing media that arrived as a route param must still publish text —
    // the param is only ever a seed, never the source of truth at publish time.
    const seeded = attachmentFromParams('file:///tmp/from-camera.jpg', 'image');
    expect(buildPostMedia(seeded).media_type).toBe('image');
    expect(buildPostMedia(null).media_type).toBe('text');
  });

  it('carries the dimensions on the attachment without writing them to the post', () => {
    // ONE-55 persists media_aspect_ratio; this ticket only makes the
    // measurement available, and must not invent the field early.
    const attachment = picked();

    expect(attachment.width).toBe(1920);
    expect(attachment.height).toBe(1080);
    expect(buildPostMedia(attachment)).not.toHaveProperty('media_aspect_ratio');
  });
});
