/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/CommentsScreens.test.tsx
//
// Post detail and comments, re-skinned (ONE-69), mounted: the full post with
// its first comments and a way to all of them; the comment row's anatomy,
// like and swipe-to-delete (yours only); the composer posting optimistically
// and clearing; and the empty, loading and error states.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  const box = (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children);
  const slot = (C: unknown) =>
    C == null ? null : React.isValidElement(C) ? C : React.createElement(C as React.FC);
  const FlatList = (props: {
    data: unknown[];
    renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    keyExtractor: (item: unknown) => string;
    ListEmptyComponent?: unknown;
  }) =>
    React.createElement(
      'div',
      { 'data-list': 'true' },
      props.data.length === 0
        ? slot(props.ListEmptyComponent)
        : props.data.map((item, index) =>
            React.createElement(React.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index })),
          ),
    );
  return {
    ...shim,
    FlatList,
    ScrollView: box,
    KeyboardAvoidingView: box,
    RefreshControl: () => null,
    Platform: { OS: 'ios' },
  };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  return {
    Swipeable: (p: { children?: React.ReactNode; renderRightActions: () => React.ReactNode }) =>
      React.createElement('div', { 'data-swipeable': 'true' }, p.children, p.renderRightActions()),
  };
});
jest.mock('expo-image', () => require('../support/expoImageStub'));
jest.mock('react-native-svg', () => {
  const React = require('react');
  const Svg = (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-fill': props.fill }, props.children as React.ReactNode);
  const leaf = () => null;
  return { __esModule: true, default: Svg, Svg, Path: leaf, Circle: leaf, G: leaf, Rect: leaf };
});

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
/** Whether there is a screen under this one: false for a cold-start link (ONE-90). */
const mockStack = { canGoBack: true };
const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace, canGoBack: () => mockStack.canGoBack }),
  useLocalSearchParams: () => mockParams.current,
  // The header's left slot renders inline, so a Back that goes home is reachable.
  Stack: { Screen: (p: { options?: { headerLeft?: () => unknown } }) => (p.options?.headerLeft ? p.options.headerLeft() : null) },
}));
const mockAuth = { status: 'signed-in' };
jest.mock('../../features/auth', () => ({ useAuthStatus: () => mockAuth.status }));

// ─── 2. Mock the data layer ─────────────────────────────────────────────

const mockApp = { isUserBlocked: () => false, addToast: jest.fn(), triggerHapticFeedback: jest.fn() };
jest.mock('../../store/AppContext.native', () => ({ useApp: () => mockApp }));
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({ profile: { username: 'me', name: 'Me', profilePicture: null }, profileId: 'p-me' }),
}));

const comment = (id: string, username: string, text: string, userId = `p-${username}`) => ({
  id, userId, username, avatar: null, text,
  timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), likes: 0, isLiked: false, replies: [],
});

const state = {
  comments: {
    data: [comment('c1', 'ana', 'first!'), comment('c2', 'me', 'mine', 'p-me')] as unknown[] | undefined,
    isPending: false,
    isError: false,
    refetch: jest.fn(() => Promise.resolve()),
  },
  post: {
    data: null as unknown,
    isPending: false,
    refetch: jest.fn(() => Promise.resolve()),
  },
};
const mockAdd = jest.fn();
const mockDelete = jest.fn();
const mockToggleLike = jest.fn();
jest.mock('../../features/comments', () => ({
  useCommentsQuery: () => state.comments,
  useAddComment: () => ({ mutate: mockAdd, isPending: false }),
  useDeleteComment: () => ({ mutate: mockDelete }),
  useToggleCommentLike: () => ({ toggle: mockToggleLike }),
  threadIdFor: (c: { id: string; parentId?: string | null }) => c.parentId ?? c.id,
}));
jest.mock('../../features/posts', () => ({ usePostQuery: () => state.post }));
jest.mock('../../components/native/PostCard', () => {
  const React = require('react');
  return (props: { post: { id: string }; detail?: boolean }) =>
    React.createElement('article', { 'data-post': props.post.id, 'data-detail': String(Boolean(props.detail)) });
});

import CommentsScreen from '../../app/comments/[postId]';
import PostDetailScreen from '../../app/post/[id]';
import { commentMeta } from '../../components/native/CommentRow';
import { color } from '../../theme/tokens';

// ─── 3. Helpers ─────────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(element: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

beforeEach(() => {
  mockParams.current = { postId: 'post-1', id: 'post-1' };
  state.comments.data = [comment('c1', 'ana', 'first!'), comment('c2', 'me', 'mine', 'p-me')];
  state.comments.isPending = false;
  state.comments.isError = false;
  state.post.data = { id: 'post-1', username: 'ana', replies: 5, content: 'x', media_type: 'text' };
  state.post.isPending = false;
  [mockPush, mockBack, mockReplace, mockAdd, mockDelete, mockToggleLike].forEach(m => m.mockClear());
  mockStack.canGoBack = true;
  mockAuth.status = 'signed-in';
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const button = (el: HTMLElement, label: string) =>
  el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;

const rgb = (hex: string) => {
  const probe = document.createElement('div');
  probe.style.color = hex;
  return probe.style.color;
};

// ─── 4. Post detail ─────────────────────────────────────────────────────

describe('Post detail', () => {
  it('shows the whole post, its first comments, and a way to all of them', () => {
    const el = mount(<PostDetailScreen />);
    const card = el.querySelector('article[data-post="post-1"]')!;
    expect(card.getAttribute('data-detail')).toBe('true');
    expect(el.textContent).toContain('first!');
    const viewAll = Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'View all 5 comments')!;
    expect(viewAll).toBeDefined();
    act(() => viewAll.click());
    expect(mockPush).toHaveBeenCalledWith('/comments/post-1');
  });

  it('shows no more than three comments inline', () => {
    state.comments.data = ['a', 'b', 'c', 'd', 'e'].map(n => comment(n, n, `from ${n}`));
    const el = mount(<PostDetailScreen />);
    expect(el.textContent).toContain('from c');
    expect(el.textContent).not.toContain('from d');
  });

  it('shows a skeleton while loading', () => {
    state.post.isPending = true;
    const el = mount(<PostDetailScreen />);
    expect(el.querySelectorAll('div[data-animated="true"]').length).toBeGreaterThan(0);
    expect(el.querySelector('article')).toBeNull();
  });

  it('shows "This post isn\'t available", with Back, for a missing post', () => {
    state.post.data = null;
    const el = mount(<PostDetailScreen />);
    expect(el.textContent).toContain("This post isn't available");
    act(() => Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Back')!.click());
    expect(mockBack).toHaveBeenCalled();
  });

  it('asks someone signed out to join, rather than saying the post is gone, as a scanned post tag lands here', () => {
    mockAuth.status = 'signed-out';
    state.post.data = null;
    const el = mount(<PostDetailScreen />);
    expect(el.textContent).toContain('Join OneTag to see this post');
    act(() => Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Join OneTag')!.click());
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/signup');
  });

  it('leaves Back to the native header when there is a screen to go back to (ONE-90)', () => {
    const el = mount(<PostDetailScreen />);
    expect(button(el, 'Back')).toBeNull();
  });

  it('goes home from Back when it is the first screen, as after a notification on a cold start (ONE-90)', () => {
    mockStack.canGoBack = false;
    const el = mount(<PostDetailScreen />);
    act(() => button(el, 'Back')!.click());
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    expect(mockBack).not.toHaveBeenCalled();
  });
});

// ─── 5. Comment rows ────────────────────────────────────────────────────

describe('Comments — rows', () => {
  it('reads "username text", then "2h · N likes", then Reply', () => {
    // Likes come with the comment, read with the post's comments.
    state.comments.data = [{ ...comment('c1', 'ana', 'first!'), likes: 3 }, comment('c2', 'me', 'mine', 'p-me')];
    const el = mount(<CommentsScreen />);
    expect(el.textContent).toContain('ana first!');
    expect(el.textContent).toContain('2h · 3 likes');
    expect(button(el, 'Reply to ana')).not.toBeNull();
  });

  it('meta drops a zero like count', () => {
    expect(commentMeta('2h', 0)).toBe('2h');
    expect(commentMeta('2h', 1)).toBe('2h · 1 like');
  });

  it('fills the heart red when liked, and toggles on tap', () => {
    state.comments.data = [{ ...comment('c1', 'ana', 'first!'), likes: 1, isLiked: true }];
    const el = mount(<CommentsScreen />);
    const liked = button(el, 'Like comment, liked')!;
    expect(liked.querySelector('svg')!.getAttribute('data-fill')).toBe(color.heart);
    act(() => liked.click());
    expect(mockToggleLike).toHaveBeenCalledWith('c1');
  });

  it('swipes to a red Delete on your own comment only', () => {
    const el = mount(<CommentsScreen />);
    const swipeables = el.querySelectorAll('[data-swipeable]');
    expect(swipeables).toHaveLength(1);
    expect(swipeables[0].textContent).toContain('mine');
    const del = button(el, 'Delete comment')!;
    const label = del.querySelector('span') as HTMLElement;
    expect(label.style.color).toBe(rgb(color.heart));
    act(() => del.click());
    expect(mockDelete).toHaveBeenCalledWith({ postId: 'post-1', commentId: 'c2' }, expect.anything());
  });
});

// ─── 6. The composer ────────────────────────────────────────────────────

describe('Comments — composer', () => {
  const composer = (el: HTMLElement) => el.querySelector('input[aria-label="Add a comment"]') as HTMLInputElement;
  const post = (el: HTMLElement) => button(el, 'Post comment')!;

  function type(el: HTMLElement, text: string) {
    const field = composer(el);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, text);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('is disabled while empty', () => {
    const el = mount(<CommentsScreen />);
    expect(post(el).disabled).toBe(true);
    expect(composer(el).getAttribute('placeholder')).toBe('Add a comment…');
  });

  it('posts, optimistically as before, and clears', () => {
    const el = mount(<CommentsScreen />);
    type(el, 'nice one');
    expect(post(el).disabled).toBe(false);
    act(() => post(el).click());
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ postId: 'post-1', text: 'nice one' }));
    expect(composer(el).value).toBe('');
  });
});

// ─── 7. Replies ─────────────────────────────────────────────────────────

describe('Comments — replies', () => {
  const composer = (el: HTMLElement) => el.querySelector('input[aria-label^="Reply to"], input[aria-label="Add a comment"]') as HTMLInputElement;

  function type(el: HTMLElement, text: string) {
    const field = composer(el);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, text);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  const withReplies = (count: number) => ({
    ...comment('c1', 'ana', 'first!'),
    replies: Array.from({ length: count }, (_, i) => ({ ...comment(`r${i + 1}`, 'bo', `reply ${i + 1}`), parentId: 'c1' })),
  });

  it('shows a reply under the comment it answers', () => {
    state.comments.data = [withReplies(1)];
    const el = mount(<CommentsScreen />);
    expect(el.textContent).toContain('bo reply 1');
    expect(button(el, 'Reply to bo')).not.toBeNull();
  });

  it('folds a longer thread behind "View N replies", and opens it', () => {
    state.comments.data = [withReplies(3)];
    const el = mount(<CommentsScreen />);
    expect(el.textContent).not.toContain('reply 1');
    const more = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'View 3 replies')!;
    act(() => more.click());
    expect(el.textContent).toContain('reply 1');
    expect(el.textContent).toContain('reply 3');
  });

  it('replies with the handle in front, into the thread of the comment answered, and says so meanwhile', () => {
    const el = mount(<CommentsScreen />);
    act(() => button(el, 'Reply to ana')!.click());
    expect(el.textContent).toContain('Replying to @ana');
    expect(composer(el).value).toBe('@ana ');
    expect(composer(el).getAttribute('placeholder')).toBe('Reply to @ana…');

    type(el, '@ana agreed');
    act(() => button(el, 'Post comment')!.click());
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ postId: 'post-1', text: '@ana agreed', parentId: 'c1' }));
    expect(el.textContent).not.toContain('Replying to');
  });

  it('files a reply to a reply under the thread it sits in', () => {
    state.comments.data = [withReplies(1)];
    const el = mount(<CommentsScreen />);
    act(() => button(el, 'Reply to bo')!.click());
    type(el, '@bo yes');
    act(() => button(el, 'Post comment')!.click());
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'c1' }));
  });

  it('asks before deleting a comment others replied to, since their replies go with it', () => {
    const { Alert } = jest.requireMock('react-native') as { Alert: { alert: jest.Mock } };
    Alert.alert.mockClear();
    state.comments.data = [
      { ...comment('c2', 'me', 'mine', 'p-me'), replies: [{ ...comment('r1', 'bo', 'agreed'), parentId: 'c2' }] },
    ];
    const el = mount(<CommentsScreen />);
    act(() => button(el, 'Delete comment')!.click());
    expect(mockDelete).not.toHaveBeenCalled();
    const [title, body, actions] = Alert.alert.mock.calls[0] as [string, string, { text: string; onPress?: () => void }[]];
    expect(title).toBe('Delete this comment?');
    expect(body).toBe('Its reply will be deleted too.');

    act(() => actions.find((a) => a.text === 'Delete')!.onPress!());
    expect(mockDelete).toHaveBeenCalledWith({ postId: 'post-1', commentId: 'c2' }, expect.anything());
  });

  it('opens a folded thread on the reply a notification is about, and marks it', () => {
    mockParams.current = { postId: 'post-1', commentId: 'r2' };
    state.comments.data = [withReplies(3)];
    const el = mount(<CommentsScreen />);
    // The thread of three would fold; it opens because a notification points into it.
    expect(el.textContent).toContain('reply 2');
    const row = Array.from(el.querySelectorAll('div')).find(
      (d) => d.textContent?.startsWith('Bbo reply 2') && d.style.backgroundColor === rgb(color.bgPanel),
    );
    expect(row).toBeDefined();
  });

  it('can be called off, leaving an ordinary comment', () => {
    const el = mount(<CommentsScreen />);
    act(() => button(el, 'Reply to ana')!.click());
    act(() => button(el, 'Cancel reply')!.click());
    expect(el.textContent).not.toContain('Replying to');
    type(el, 'just a comment');
    act(() => button(el, 'Post comment')!.click());
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ parentId: null }));
  });

  it('puts no handle in front of a reply to yourself', () => {
    const el = mount(<CommentsScreen />);
    act(() => button(el, 'Reply to me')!.click());
    expect(composer(el).value).toBe('');
  });
});

// ─── 8. Empty, loading, error ───────────────────────────────────────────

describe('Comments — states', () => {
  it('invites the first comment, focusing the composer on tap', () => {
    state.comments.data = [];
    const el = mount(<CommentsScreen />);
    expect(el.textContent).toContain('No comments yet');
    expect(el.textContent).toContain('Start the conversation.');
    const invite = Array.from(el.querySelectorAll('button[aria-label="Add a comment"]'))[0] as HTMLButtonElement;
    act(() => invite.click());
    expect(document.activeElement).toBe(el.querySelector('input[aria-label="Add a comment"]'));
  });

  it('shows skeleton rows while loading', () => {
    state.comments.isPending = true;
    state.comments.data = undefined;
    const el = mount(<CommentsScreen />);
    expect(el.querySelectorAll('div[data-animated="true"]').length).toBeGreaterThan(5);
  });

  it('offers Retry when the comments fail to load', () => {
    state.comments.isError = true;
    state.comments.data = undefined;
    const el = mount(<CommentsScreen />);
    expect(el.textContent).toContain("Couldn't load comments");
    act(() => Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Retry')!.click());
    expect(state.comments.refetch).toHaveBeenCalled();
  });
});
