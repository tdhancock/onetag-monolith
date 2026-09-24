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
  mediaAspectRatio,
  clampAspectRatio,
  MIN_ASPECT_RATIO,
  MAX_ASPECT_RATIO,
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
      media_aspect_ratio: 1920 / 1080,
    });
  });

  it('publishes a text post once the attachment is removed', () => {
    expect(buildPostMedia(null)).toEqual({
      media: undefined,
      media_type: 'text',
      media_aspect_ratio: null,
    });
  });

  it('derives media_type from the attachment, not from a stale route param', () => {
    // Removing media that arrived as a route param must still publish text —
    // the param is only ever a seed, never the source of truth at publish time.
    const seeded = attachmentFromParams('file:///tmp/from-camera.jpg', 'image');
    expect(buildPostMedia(seeded).media_type).toBe('image');
    expect(buildPostMedia(null).media_type).toBe('text');
  });

  it('writes the measured ratio onto the post (ONE-55)', () => {
    // ONE-57 carried the dimensions on the attachment and deliberately left
    // the field off the post. ONE-55 is where it lands.
    const attachment = picked();

    expect(attachment.width).toBe(1920);
    expect(attachment.height).toBe(1080);
    expect(buildPostMedia(attachment).media_aspect_ratio).toBeCloseTo(16 / 9, 6);
  });

  it('leaves the ratio null when the source reported no dimensions', () => {
    // The route-param path from the camera tab may arrive without them; the
    // post then renders at PostCard's 4:5 fallback rather than a guess.
    const seeded = attachmentFromParams('file:///tmp/from-camera.jpg', 'image');

    expect(buildPostMedia(seeded).media_aspect_ratio).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Measuring the aspect ratio (ONE-55)
// ---------------------------------------------------------------------------
//
// Every image used to render at 4:5 because nothing ever populated
// `posts.media_aspect_ratio` — a landscape photo was cropped to portrait and a
// square one stretched. The ratio is measured once, here, from the dimensions
// the source reported.

describe('mediaAspectRatio', () => {
  it('measures a landscape photo as wider than tall', () => {
    expect(mediaAspectRatio(picked({ width: 1920, height: 1080 }))).toBeCloseTo(16 / 9, 6);
  });

  it('measures a portrait photo as taller than wide', () => {
    expect(mediaAspectRatio(picked({ width: 1080, height: 1350 }))).toBeCloseTo(0.8, 3);
  });

  it('measures a square photo as 1', () => {
    expect(mediaAspectRatio(picked({ width: 1000, height: 1000 }))).toBe(1);
  });

  it('clamps a panorama to the widest publishable framing', () => {
    // 5:1 would wreck the feed layout. Stored clamped, rendered letterboxed.
    expect(mediaAspectRatio(picked({ width: 5000, height: 1000 }))).toBe(MAX_ASPECT_RATIO);
  });

  it('clamps a full-page screenshot to the tallest publishable framing', () => {
    expect(mediaAspectRatio(picked({ width: 1000, height: 4000 }))).toBe(MIN_ASPECT_RATIO);
  });

  it('returns null rather than a guess when dimensions are missing', () => {
    expect(mediaAspectRatio(picked({ width: null, height: null }))).toBeNull();
    expect(mediaAspectRatio(picked({ width: 1920, height: null }))).toBeNull();
    expect(mediaAspectRatio(null)).toBeNull();
  });

  it('returns null for a zero dimension rather than dividing by it', () => {
    expect(mediaAspectRatio(picked({ width: 1920, height: 0 }))).toBeNull();
    expect(mediaAspectRatio(picked({ width: 0, height: 1080 }))).toBeNull();
  });

  it('leaves a ratio already inside the bounds untouched', () => {
    expect(clampAspectRatio(1)).toBe(1);
    expect(clampAspectRatio(MIN_ASPECT_RATIO)).toBe(MIN_ASPECT_RATIO);
    expect(clampAspectRatio(MAX_ASPECT_RATIO)).toBe(MAX_ASPECT_RATIO);
  });
});

// ---------------------------------------------------------------------------
// 4. The ratio survives the camera → compose → publish path
// ---------------------------------------------------------------------------

describe('camera → compose → publish', () => {
  it('carries the dimensions the camera tab pushed as route params', () => {
    // The camera tab stringifies takePictureAsync's width/height into params.
    const seeded = attachmentFromParams('file:///tmp/shot.jpg', 'image', '1920', '1080');

    expect(seeded).toEqual({
      uri: 'file:///tmp/shot.jpg',
      width: 1920,
      height: 1080,
      mediaType: 'image',
    });
    expect(buildPostMedia(seeded).media_aspect_ratio).toBeCloseTo(16 / 9, 6);
  });

  it('ignores unusable dimension params instead of publishing NaN', () => {
    // `String(undefined ?? '')` yields '' when the source reported nothing.
    expect(attachmentFromParams('file:///tmp/a.jpg', 'image', '', '')).toEqual({
      uri: 'file:///tmp/a.jpg',
      width: null,
      height: null,
      mediaType: 'image',
    });
    expect(attachmentFromParams('file:///tmp/a.jpg', 'image', 'wide', '0')).toEqual({
      uri: 'file:///tmp/a.jpg',
      width: null,
      height: null,
      mediaType: 'image',
    });
  });
});
