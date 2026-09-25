/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/NotificationsScreen.test.tsx
//
// The re-skinned notifications screen (ONE-72), mounted: sections by
// recency, the sentence with its bold sender and the post thumbnail, Follow
// back inline, the unread dots that outlive marking everything read, and the
// empty, loading and error states.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  const SectionList = (props: {
    sections: { key: string; title: string; data: { id: string }[] }[];
    renderItem: (info: { item: unknown }) => React.ReactNode;
    renderSectionHeader: (info: { section: unknown }) => React.ReactNode;
    ListEmptyComponent?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-sections': 'true' },
      props.sections.length === 0
        ? props.ListEmptyComponent
        : props.sections.map(section =>
            React.createElement(
              'section',
              { key: section.key, 'data-section': section.key },
              props.renderSectionHeader({ section }),
              section.data.map(item => React.createElement(React.Fragment, { key: item.id }, props.renderItem({ item }))),
            ),
          ),
    );
  return { ...shim, SectionList, RefreshControl: () => null };
}, { virtual: true });
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
}, { virtual: true });
jest.mock('expo-image', () => {
  const React = require('react');
  return { Image: (p: { source?: { uri: string } }) => React.createElement('img', { src: p.source?.uri }) };
}, { virtual: true });
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'), { virtual: true });

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  Stack: { Screen: () => null },
}), { virtual: true });

// ─── 2. Mock the data layer ─────────────────────────────────────────────

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

const notification = (overrides: Record<string, unknown>) => ({
  id: 'n',
  type: 'like',
  is_read: true,
  created_at: hoursAgo(0.05),
  sender: { id: 'p-ana', username: 'ana', avatar_url: null },
  post: null,
  ...overrides,
});

const state = {
  query: {
    data: undefined as unknown[] | undefined,
    isPending: false,
    isError: false,
    refetch: jest.fn(() => Promise.resolve()),
  },
  following: new Set<string>(),
};
const mockMarkAll = jest.fn();
const mockFollowToggle = jest.fn();
jest.mock('../../features/notifications', () => ({
  useNotificationsQuery: () => state.query,
  useMarkAllRead: () => ({ mutate: mockMarkAll }),
}), { virtual: true });
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({ profileId: 'p-me' }),
  useFollowState: () => ({ isFollowing: (u: string) => state.following.has(u) }),
  useToggleFollow: () => ({ toggle: mockFollowToggle, isPending: false }),
}), { virtual: true });

import NotificationsScreen from '../../app/notifications';

// ─── 3. Helpers ─────────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<NotificationsScreen />));
  return container;
}

// A fixed afternoon, so "half an hour ago" is never yesterday. Only Date is
// faked; React's scheduling keeps real timers.
beforeAll(() => {
  jest.useFakeTimers({
    now: new Date(2026, 8, 24, 15, 0, 0),
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'nextTick', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'hrtime'],
  });
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  state.query.data = [];
  state.query.isPending = false;
  state.query.isError = false;
  state.following = new Set();
  [mockPush, mockMarkAll, mockFollowToggle].forEach(m => m.mockClear());
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const rowFor = (el: HTMLElement, sender: string, sentence: string) =>
  Array.from(el.querySelectorAll('button')).find(
    b => (b.getAttribute('aria-label') ?? '').includes(`${sender} ${sentence}`),
  ) as HTMLButtonElement | undefined;

// ─── 4. Sections ────────────────────────────────────────────────────────

describe('Notifications — sections', () => {
  it('puts today\'s under TODAY and last week\'s under THIS WEEK, newest first', () => {
    state.query.data = [
      notification({ id: 'week', created_at: daysAgo(3) }),
      notification({ id: 'old-today', created_at: hoursAgo(0.5), sender: { id: 'p-ben', username: 'ben', avatar_url: null } }),
      notification({ id: 'new-today', created_at: hoursAgo(0.1), sender: { id: 'p-cy', username: 'cy', avatar_url: null } }),
    ];
    const el = mount();
    const today = el.querySelector('section[data-section="today"]')!;
    const week = el.querySelector('section[data-section="week"]')!;
    expect(today.textContent).toContain('Today');
    expect(week.textContent).toContain('This week');
    const todayText = today.textContent!;
    expect(todayText.indexOf('cy')).toBeLessThan(todayText.indexOf('ben'));
    expect(week.textContent).toContain('ana');
  });
});

// ─── 5. Rows ────────────────────────────────────────────────────────────

describe('Notifications — rows', () => {
  it('names the sender in bold and shows the post\'s thumbnail on the right', () => {
    state.query.data = [
      notification({ id: 'like', post: { id: 'post-1', content: '', media: 'https://example.test/p.jpg', media_type: 'image' } }),
    ];
    const el = mount();
    const row = rowFor(el, 'ana', 'liked your post.')!;
    const sender = Array.from(row.querySelectorAll('span')).find(s => s.textContent === 'ana') as HTMLElement;
    expect(sender.style.fontFamily).toContain('Bold');
    expect(row.querySelector('img')?.getAttribute('src')).toBe('https://example.test/p.jpg');
    act(() => row.click());
    expect(mockPush).toHaveBeenCalledWith('/post/post-1');
  });

  it('shows a text post\'s first line as its thumbnail', () => {
    state.query.data = [notification({ id: 'c', type: 'comment', post: { id: 'p', content: 'hello\nthere', media: null, media_type: 'text' } })];
    const el = mount();
    expect(rowFor(el, 'ana', 'commented on your post.')!.textContent).toContain('hello');
  });

  it('offers Follow back on a follow, which works inline', () => {
    state.query.data = [notification({ id: 'f', type: 'follow' })];
    const el = mount();
    const row = rowFor(el, 'ana', 'started following you.')!;
    const followButton = Array.from(row.querySelectorAll('button')).find(b => b.textContent === 'Follow')!;
    act(() => followButton.click());
    expect(mockFollowToggle).toHaveBeenCalledWith({ userId: 'p-ana', username: 'ana' });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('reads Following when you already follow them back', () => {
    state.following = new Set(['ana']);
    state.query.data = [notification({ id: 'f', type: 'follow' })];
    const el = mount();
    expect(rowFor(el, 'ana', 'started following you.')!.textContent).toContain('Following');
  });
});

// ─── 6. Unread ──────────────────────────────────────────────────────────

describe('Notifications — unread', () => {
  it('dots the rows that were unread on opening, while marking everything read', () => {
    state.query.data = [
      notification({ id: 'unread', is_read: false }),
      notification({ id: 'read', is_read: true, type: 'repost', sender: { id: 'p-ben', username: 'ben', avatar_url: null } }),
    ];
    const el = mount();
    expect(mockMarkAll).toHaveBeenCalledTimes(1);
    expect(rowFor(el, 'ana', 'liked your post.')!.getAttribute('aria-label')).toMatch(/^New\. /);
    expect(rowFor(el, 'ben', 'reposted your post.')!.getAttribute('aria-label')).not.toMatch(/^New\. /);

    // The server copy comes back read; the dot stays for this visit.
    state.query.data = (state.query.data as Record<string, unknown>[]).map(x => ({ ...x, is_read: true }));
    act(() => root!.render(<NotificationsScreen />));
    expect(rowFor(el, 'ana', 'liked your post.')!.getAttribute('aria-label')).toMatch(/^New\. /);
  });

  it('waits for the list before marking it read', () => {
    state.query.isPending = true;
    state.query.data = undefined;
    mount();
    expect(mockMarkAll).not.toHaveBeenCalled();
  });
});

// ─── 7. States ──────────────────────────────────────────────────────────

describe('Notifications — states', () => {
  it('is all caught up when there is nothing', () => {
    const el = mount();
    expect(el.textContent).toContain("You're all caught up");
    expect(el.textContent).toContain('Likes, follows and comments will show up here.');
  });

  it('shows skeleton rows while loading', () => {
    state.query.isPending = true;
    state.query.data = undefined;
    const el = mount();
    expect(el.querySelectorAll('div[data-animated="true"]').length).toBeGreaterThan(5);
  });

  it('offers Retry when the list fails to load', () => {
    state.query.isError = true;
    state.query.data = undefined;
    const el = mount();
    act(() => Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Retry')!.click());
    expect(state.query.refetch).toHaveBeenCalled();
  });
});
