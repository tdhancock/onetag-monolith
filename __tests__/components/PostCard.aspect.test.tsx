/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/PostCard.aspect.test.tsx
//
// How a post's image is framed in the feed (ONE-55).
//
// Nothing ever populated `posts.media_aspect_ratio`, so every row was written
// null and PostCard's fallback framed every photo at 4:5 — a landscape shot
// cropped to portrait, a square one stretched. These tests read the
// `aspectRatio` off the box PostCard wraps the image in, which is the value
// the feed actually lays out with.
//
// Two things are pinned here deliberately:
//   1. A post carrying a ratio is framed at that ratio, not the fallback.
//   2. A post published before ONE-55 (ratio null) still renders at 4:5
//      without error — the fallback stays for legacy rows, which is why the
//      ticket ruled out a backfill.

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

// ─── 1. Mock the native runtime and everything PostCard reaches for ─────

// The shared shim, with `View` wrapped so every style it is handed is
// recorded. jsdom's CSSStyleDeclaration does not implement `aspect-ratio`, so
// reading it back off the mounted node returns '' — the style PostCard built
// the view with is the honest place to assert.
const viewStyles: Record<string, unknown>[] = [];

jest.mock('react-native', () => {
  const shim = require('../support/reactNativeDom');
  return {
    ...shim,
    View: (props: Record<string, unknown>) => {
      viewStyles.push(shim.flattenStyle(props.style));
      return shim.View(props);
    },
  };
}, { virtual: true });
jest.mock('expo-image', () => require('../support/expoImageStub'), { virtual: true });
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'), { virtual: true });
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }), {
  virtual: true,
});
jest.mock('../../features/moderation', () => ({ reportPost: jest.fn() }), { virtual: true });
jest.mock('../../features/admin', () => ({ useIsAdmin: () => false }), { virtual: true });
jest.mock('../../features/auth', () => ({ useAuthUserId: () => undefined }), { virtual: true });

// The toggle hooks need a QueryClientProvider, and this suite is about
// framing rather than mutations — a stub keeps the mount free of both.
jest.mock('../../features/posts', () => {
  const stub = () => ({ toggle: jest.fn(), isPending: false });
  return {
    useLikePost: stub,
    useRepostPost: stub,
    useSavePost: stub,
    useDeletePost: () => ({ mutate: jest.fn(), isPending: false }),
  };
}, { virtual: true });

// PostCard reads a dozen actions off the context. None of them fire during a
// plain render, so a no-op shape is enough to mount it.
jest.mock('../../store/AppContext.native', () => ({
  useApp: () => ({
    isPostLiked: () => false,
    togglePostLike: jest.fn(),
    areCommentsLoaded: () => false,
    userProfile: { username: 'tanner', name: 'Tanner', profilePicture: null },
    deleteProfilePost: jest.fn(),
    getComments: () => [],
    addToast: jest.fn(),
    isPostReposted: () => false,
    togglePostRepost: jest.fn(),
    isPostSaved: () => false,
    toggleSavePost: jest.fn(),
    triggerHapticFeedback: jest.fn(),
  }),
}), { virtual: true });

import PostCard from '../../components/native/PostCard';
import type { Post } from '../../types';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

const FALLBACK = 1080 / 1350; // 4:5 — what a pre-ONE-55 row still renders at

const imagePost = (media_aspect_ratio: number | null): Post => ({
  id: 'post-1',
  content: '',
  username: 'tanner',
  name: 'Tanner',
  avatar: null,
  timestamp: new Date().toISOString(),
  media: 'https://example.supabase.co/storage/v1/object/public/post-media/a.jpg',
  media_type: 'image',
  media_aspect_ratio,
  likes: 0,
  reposts: 0,
  replies: 0,
} as unknown as Post);

/**
 * The aspectRatio the image's own box was laid out with. PostCard puts it on
 * the `View` that wraps the image, alongside the black backdrop it letterboxes
 * against — so this is the value the feed frames the photo with.
 */
function renderedAspectRatio(post: Post): number | undefined {
  viewStyles.length = 0;

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(React.createElement(PostCard, { post } as never));
  });

  act(() => root.unmount());
  container.remove();

  // The image's box is the only view carrying an aspectRatio.
  const framed = viewStyles.filter(style => typeof style.aspectRatio === 'number');
  expect(framed).toHaveLength(1);

  return framed[0].aspectRatio as number;
}

// ─── 3. Tests ───────────────────────────────────────────────────────────

describe('PostCard image framing', () => {
  it('frames a landscape post at the ratio it was captured at', () => {
    expect(renderedAspectRatio(imagePost(16 / 9))).toBeCloseTo(16 / 9, 4);
  });

  it('frames a square post at 1:1 rather than cropping it to portrait', () => {
    expect(renderedAspectRatio(imagePost(1))).toBeCloseTo(1, 4);
  });

  it('keeps the 4:5 fallback for a post published before ONE-55', () => {
    // Legacy rows hold null. Backfilling would mean fetching every stored
    // image to measure it, so the fallback stays.
    expect(renderedAspectRatio(imagePost(null))).toBeCloseTo(FALLBACK, 4);
  });

  it('renders a legacy post without throwing', () => {
    expect(() => renderedAspectRatio(imagePost(null))).not.toThrow();
  });
});
