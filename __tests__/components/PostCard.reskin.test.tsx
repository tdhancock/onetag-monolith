/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/PostCard.reskin.test.tsx
//
// The re-skinned post card (ONE-65): an edge-to-edge post on white with the
// header above the content and the actions below, counts that hide at zero,
// truncation with "more", and the ⋯ sheet leading to the report reasons.
//
// react-native-svg is stubbed here with DOM elements that carry their fill
// and stroke as data attributes, so a liked heart's colour is readable off
// the mounted tree. View and Pressable likewise record the React Native style
// they were given, since jsdom drops RN-only keys such as paddingHorizontal.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

// ─── 1. Mock the native runtime and everything PostCard reaches for ─────

jest.mock('react-native', () => {
  const shim = require('../support/reactNativeDom');
  const raw = (style: unknown) =>
    JSON.stringify(
      shim.flattenStyle(
        typeof style === 'function' ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : style,
      ),
    );
  return {
    ...shim,
    View: (props: Record<string, unknown>) => shim.View({ ...props, 'data-raw-style': raw(props.style) }),
    Pressable: (props: Record<string, unknown>) =>
      shim.Pressable({ ...props, 'data-raw-style': raw(props.style) }),
  };
});
jest.mock('expo-image', () => require('../support/expoImageStub'));
jest.mock('react-native-svg', () => {
  const React = require('react');
  const Svg = (props: Record<string, unknown>) =>
    React.createElement(
      'svg',
      { 'data-fill': props.fill, 'data-stroke': props.stroke, 'data-stroke-width': props.strokeWidth },
      props.children,
    );
  const leaf = (name: string) => () => React.createElement(name);
  return { __esModule: true, default: Svg, Svg, Path: leaf('path'), Circle: leaf('circle'), G: leaf('g'), Rect: leaf('rect') };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../../features/moderation', () => ({ reportPost: jest.fn() }));
jest.mock('../../features/admin', () => ({ useIsAdmin: () => false }));
jest.mock('../../features/auth', () => ({ useAuthUserId: () => undefined }));
// The Embedded Tags overlay's scan write (ONE-45); these posts carry no tags.
jest.mock('../../features/tags', () => ({ useRecordScan: () => ({ mutate: jest.fn() }) }));
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({
    profile: { id: 'p-tanner', username: 'tanner', name: 'Tanner', profilePicture: null },
    profileId: 'p-tanner',
    authUserId: 'a-tanner',
    status: 'ready',
  }),
}));

const mockToggle = jest.fn();
jest.mock('../../features/posts', () => {
  const stub = () => ({ toggle: mockToggle, isPending: false });
  return {
    useLikePost: stub,
    useRepostPost: stub,
    useSavePost: stub,
    useDeletePost: () => ({ mutate: jest.fn(), isPending: false }),
  };
});

jest.mock('../../store/AppContext.native', () => ({
  useApp: () => ({ addToast: jest.fn(), triggerHapticFeedback: jest.fn() }),
}));

import PostCard from '../../components/native/PostCard';
import { POST_REPORT_REASONS } from '../../services/reportReasons';
import { POST_CARD_MAX_CHARS } from '../../lib/screens/postCard';
import { color } from '../../theme/tokens';
import type { Post } from '../../types';

// ─── 2. Helpers ─────────────────────────────────────────────────────────

const basePost = (overrides: Partial<Post> = {}): Post => ({
  id: 'post-1',
  content: '',
  username: 'jordan',
  name: 'Jordan Reeves',
  avatar: null,
  timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  media: 'https://example.test/a.jpg',
  media_type: 'image',
  media_aspect_ratio: 1,
  likes: 0,
  reposts: 0,
  replies: 0,
  isLiked: false,
  isReposted: false,
  isSaved: false,
  ...overrides,
} as unknown as Post);

interface MountHandle {
  root: Root;
  container: HTMLDivElement;
}

let handle: MountHandle | null = null;

function mount(post: Post, props: Record<string, unknown> = {}): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(PostCard, { post, ...props } as never));
  });
  handle = { root, container };
  return container;
}

afterEach(() => {
  if (handle) {
    act(() => handle!.root.unmount());
    handle.container.remove();
    handle = null;
  }
  mockToggle.mockClear();
});

const rgb = (hex: string) => {
  const probe = document.createElement('div');
  probe.style.color = hex;
  return probe.style.color;
};

const button = (container: HTMLElement, label: string) =>
  container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;

const text = (container: HTMLElement) => container.textContent ?? '';

/** Whether `a` comes before `b` in document order. */
const precedes = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

// ─── 3. Layout ──────────────────────────────────────────────────────────

describe('PostCard — an image post', () => {
  it('sits on a white ground, header above the image and actions below', () => {
    const container = mount(basePost());
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.backgroundColor).toBe(rgb(color.bg));
    expect(card.style.borderBottomWidth).toBe('1px');

    const name = Array.from(container.querySelectorAll('span')).find(
      s => s.textContent === 'Jordan Reeves',
    )!;
    const like = button(container, 'Like, not liked')!;
    // The media box: the only view with the bgPanel fill and full width.
    const media = Array.from(container.querySelectorAll('div')).find(
      d => d.style.backgroundColor === rgb(color.bgPanel) && d.style.width === '100%',
    )!;
    expect(media).toBeDefined();
    expect(precedes(name, media)).toBe(true);
    expect(precedes(media, like)).toBe(true);
  });

  it('runs the image full-bleed, with no horizontal padding around it', () => {
    const container = mount(basePost());
    const media = Array.from(container.querySelectorAll('div')).find(
      d => d.style.backgroundColor === rgb(color.bgPanel) && d.style.width === '100%',
    )!;
    const horizontal = ['padding', 'paddingHorizontal', 'paddingLeft', 'paddingRight',
      'margin', 'marginHorizontal', 'marginLeft', 'marginRight'];
    let node: HTMLElement | null = media;
    while (node && node !== container) {
      const style = JSON.parse(node.getAttribute('data-raw-style') ?? '{}') as Record<string, unknown>;
      for (const key of horizontal) expect(style[key] ?? 0).toBe(0);
      node = node.parentElement;
    }
  });

  it('shows "@handle · 2h" under the name', () => {
    expect(text(mount(basePost()))).toContain('@jordan · 2h');
  });
});

// ─── 4. Likes and saves ─────────────────────────────────────────────────

describe('PostCard — like and save state', () => {
  it('fills a liked heart heart-red via the token, with "N likes" beneath the actions', () => {
    const container = mount(basePost({ isLiked: true, likes: 128 } as unknown as Partial<Post>));
    const like = button(container, 'Like, liked')!;
    const heart = like.querySelector('svg')!;
    expect(heart.getAttribute('data-fill')).toBe(color.heart);
    expect(color.heart).toBe('#e53935');

    const count = Array.from(container.querySelectorAll('span')).find(
      s => s.textContent === '128 likes',
    )!;
    expect(count).toBeDefined();
    expect(precedes(like, count)).toBe(true);
  });

  it('draws the actions in ink at a 1.8 stroke', () => {
    const container = mount(basePost());
    const comment = button(container, 'Comment')!.querySelector('svg')!;
    expect(comment.getAttribute('data-stroke')).toBe(color.text);
    expect(comment.getAttribute('data-stroke-width')).toBe('1.8');
  });

  it('fills Save in ink when saved, and says so', () => {
    const container = mount(basePost({ isSaved: true } as unknown as Partial<Post>));
    const save = button(container, 'Save, saved')!.querySelector('svg')!;
    expect(save.getAttribute('data-fill')).toBe(color.text);
    expect(button(mount(basePost()), 'Save, not saved')).not.toBeNull();
  });

  it('toggles Like on press', () => {
    const container = mount(basePost());
    act(() => button(container, 'Like, not liked')!.click());
    expect(mockToggle).toHaveBeenCalledWith('post-1');
  });
});

// ─── 5. Counts hide at zero ─────────────────────────────────────────────

describe('PostCard — counts', () => {
  it('shows neither count line with zero likes and zero comments', () => {
    const t = text(mount(basePost({ likes: 0, replies: 0 } as unknown as Partial<Post>)));
    expect(t).not.toMatch(/\blikes?\b/);
    expect(t).not.toMatch(/comment/i);
    expect(t).not.toMatch(/\b0\b/);
  });

  it('shows "View all N comments", which opens comments', () => {
    const onViewComments = jest.fn();
    const container = mount(basePost({ replies: 12 } as unknown as Partial<Post>), { onViewComments });
    const link = Array.from(container.querySelectorAll('span')).find(
      s => s.textContent === 'View all 12 comments',
    )!;
    expect(link.style.color).toBe(rgb(color.textMuted));
    act(() => (link.closest('button') as HTMLButtonElement).click());
    expect(onViewComments).toHaveBeenCalledWith('post-1');
  });
});

// ─── 6. Text posts ──────────────────────────────────────────────────────

describe('PostCard — a text-only post', () => {
  const long = 'word '.repeat(80).trim();

  it('truncates past the limit with "more", and "more" expands it', () => {
    expect(long.length).toBeGreaterThan(POST_CARD_MAX_CHARS);
    const container = mount(basePost({ media_type: 'text', media: null, content: long } as unknown as Partial<Post>));
    expect(text(container)).toContain('…');
    const more = container.querySelector('span[aria-label="Show more"]') as HTMLElement;
    expect(more).not.toBeNull();

    act(() => more.click());
    expect(text(container)).toContain(long);
    expect(container.querySelector('span[aria-label="Show more"]')).toBeNull();
  });

  it('sets the text as the content at 17/26, in no grey box', () => {
    const container = mount(basePost({ media_type: 'text', media: null, content: 'hello' } as unknown as Partial<Post>));
    const body = Array.from(container.querySelectorAll('span')).find(
      s => s.style.fontSize === '17px',
    )!;
    expect(parseFloat(body.style.lineHeight)).toBe(26);
    expect(body.textContent).toBe('hello');
    let node: HTMLElement | null = body;
    while (node && node !== container) {
      expect(node.style.backgroundColor === '' || node.style.backgroundColor === rgb(color.bg)).toBe(true);
      node = node.parentElement;
    }
  });
});

// ─── 7. The ⋯ sheet ─────────────────────────────────────────────────────

describe('PostCard — options sheet', () => {
  it('on someone else\'s post, offers Report, which leads to the reasons', () => {
    const container = mount(basePost());
    act(() => button(container, 'Post options')!.click());

    const report = button(container, 'Report Post')!;
    expect(report).not.toBeNull();
    expect(button(container, 'Delete Post')).toBeNull();

    act(() => report.click());
    for (const reason of POST_REPORT_REASONS) {
      expect(button(container, reason)).not.toBeNull();
    }
    expect(text(container)).toContain('Why are you reporting this?');
  });

  it('on your own post, offers Delete in heart red, and a Cancel', () => {
    const container = mount(basePost({ username: 'tanner' } as unknown as Partial<Post>));
    act(() => button(container, 'Post options')!.click());
    const del = button(container, 'Delete Post')!;
    const label = Array.from(del.querySelectorAll('span')).find(s => s.textContent === 'Delete Post')!;
    expect(label.style.color).toBe(rgb(color.heart));
    expect(text(container)).toContain('Cancel');
  });
});
