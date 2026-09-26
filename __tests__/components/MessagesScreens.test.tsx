/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/MessagesScreens.test.tsx
//
// Messages and the share picker, re-skinned (ONE-70), mounted: the inbox's
// conversation rows with their unread dot, long-press delete through the
// sheet, and its empty and loading states; a thread's ink and panel bubbles,
// the "Sending…" → "Sent" status line, replying from the long-press sheet,
// and the empty thread; and the share picker's per-row "Sent".

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
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
    RefreshControl: () => null,
    Platform: { OS: 'ios' },
    Linking: { openURL: jest.fn() },
  };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('expo-image', () => require('../support/expoImageStub'));
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));

const mockPush = jest.fn();
const mockParams: { current: Record<string, string> } = { current: {} };
// The header renders its title and side controls, so a suite can press them.
jest.mock('expo-router', () => {
  const React = require('react');
  type Options = {
    title?: string;
    headerTitle?: unknown;
    headerLeft?: () => React.ReactNode;
    headerRight?: () => React.ReactNode;
  };
  const Screen = ({ options }: { options?: Options }) =>
    React.createElement(
      'header',
      null,
      options?.headerLeft?.(),
      typeof options?.headerTitle === 'function'
        ? (options.headerTitle as (p: { children: string }) => React.ReactNode)({ children: options.title ?? '' })
        : React.createElement('h1', null, options?.title),
      options?.headerRight?.(),
    );
  return {
    useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true }),
    useLocalSearchParams: () => mockParams.current,
    Stack: { Screen },
  };
});

// ─── 2. Mock the data layer ─────────────────────────────────────────────

const mockApp = { addToast: jest.fn(), triggerHapticFeedback: jest.fn() };
jest.mock('../../store/AppContext.native', () => ({ useApp: () => mockApp }));

const mockSearchUsers = jest.fn((_q: string) => Promise.resolve([] as unknown[]));
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({ profile: { username: 'me', name: 'Me', profilePicture: null }, profileId: 'p-me' }),
  getUserProfile: jest.fn(() => Promise.resolve(null)),
  searchUsers: (q: string) => mockSearchUsers(q),
}));

const ana = { id: 'p-ana', username: 'ana', name: 'Ana Silva', avatar: null };
const bo = { id: 'p-bo', username: 'bo', name: 'Bo', avatar: null };

const at = (h: number, m: number) => new Date(2026, 8, 24, h, m).toISOString();
const msg = (id: string, sender: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  sender_id: sender,
  receiver_id: sender === 'p-me' ? 'p-ana' : 'p-me',
  text,
  created_at: at(14, 30),
  type: 'text',
  ...extra,
});

const state = {
  conversations: {
    data: [ana, bo] as unknown[] | undefined,
    isLoading: false,
    isError: false,
    refetch: jest.fn(() => Promise.resolve()),
  },
  thread: { data: [] as unknown[] | undefined, isLoading: false },
  unread: new Set<string>(),
};
const mockSend = jest.fn();
const mockSendAsync = jest.fn((_input: unknown) => Promise.resolve());
const mockMarkChatRead = jest.fn();
const mockMarkAll = jest.fn();
const mockDelete = jest.fn();
jest.mock('../../features/messages', () => ({
  useConversationsQuery: () => state.conversations,
  useThreadQuery: () => state.thread,
  useUnreadChats: () => state.unread,
  useSendMessage: () => ({ mutate: mockSend, mutateAsync: mockSendAsync }),
  useMarkChatRead: () => ({ mutate: mockMarkChatRead }),
  useMarkAllMessagesRead: () => ({ mutate: mockMarkAll }),
  useDeleteConversation: () => ({ mutate: mockDelete }),
  isPendingMessage: (m: { id: string }) => m.id.startsWith('temp-'),
}));

const sharedPost = { id: 'post-9', username: 'ana', avatar: null, content: 'Kitchen install\nsecond line', media_type: 'text' };
const mockFetchPost = jest.fn((_id: string) => Promise.resolve(sharedPost as unknown));
jest.mock('../../features/posts', () => ({
  fetchPostById: (id: string) => mockFetchPost(id),
}));

import MessagesScreen from '../../app/messages';
import SharePostScreen from '../../app/share-post';
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

const rerender = (element: React.ReactElement) => act(() => root!.render(element));

beforeEach(() => {
  mockParams.current = {};
  state.conversations.data = [ana, bo];
  state.conversations.isLoading = false;
  state.conversations.isError = false;
  state.thread.data = [];
  state.thread.isLoading = false;
  state.unread = new Set();
  mockSearchUsers.mockImplementation(() => Promise.resolve([]));
  mockFetchPost.mockImplementation(() => Promise.resolve(sharedPost));
  [mockPush, mockSend, mockSendAsync, mockMarkChatRead, mockMarkAll, mockDelete, mockApp.addToast].forEach(m => m.mockClear());
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const button = (el: HTMLElement, label: string) =>
  el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const buttonWithText = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find(b => b.textContent === text) as HTMLButtonElement | undefined;
const longPress = (target: Element) =>
  act(() => {
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  });

const rgb = (hex: string) => {
  const probe = document.createElement('div');
  probe.style.color = hex;
  return probe.style.color;
};

const typeInto = (input: HTMLInputElement, value: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

/** Opens Ana's thread from the inbox. */
const openAna = (el: HTMLElement) => act(() => button(el, 'Conversation with ana')!.click());

// ─── 4. Inbox ───────────────────────────────────────────────────────────

describe('Messages — inbox', () => {
  it('titles the header "Messages", with a new-message button', () => {
    const el = mount(<MessagesScreen />);
    expect(el.querySelector('h1')!.textContent).toBe('Messages');
    expect(button(el, 'New message')).not.toBeNull();
  });

  it('renders each conversation as a row with its name and @handle', () => {
    const el = mount(<MessagesScreen />);
    const row = button(el, 'Conversation with ana')!;
    expect(row.textContent).toContain('Ana Silva');
    expect(row.textContent).toContain('@ana');
  });

  it('marks an unread conversation with an ink dot, and only that one', () => {
    state.unread = new Set(['p-ana']);
    const el = mount(<MessagesScreen />);
    const unread = button(el, 'Unread. Conversation with ana')!;
    expect(unread).not.toBeNull();
    const dot = Array.from(unread.querySelectorAll('div')).find(
      d => d.style.width === '8px' && d.style.height === '8px',
    )!;
    expect(dot.style.backgroundColor).toBe(rgb(color.text));

    const read = button(el, 'Conversation with bo')!;
    expect(Array.from(read.querySelectorAll('div')).some(d => d.style.width === '8px')).toBe(false);
  });

  it('deletes a conversation from the long-press sheet', () => {
    const el = mount(<MessagesScreen />);
    longPress(button(el, 'Conversation with ana')!);
    expect(el.textContent).toContain('Conversation with @ana');
    act(() => button(el, 'Delete for both sides')!.click());
    expect(mockDelete).toHaveBeenCalledWith('p-ana', expect.any(Object));
  });

  it('shows "No messages yet" with a Find people action when empty', () => {
    state.conversations.data = [];
    const el = mount(<MessagesScreen />);
    expect(el.textContent).toContain('No messages yet');
    expect(buttonWithText(el, 'Find people')).toBeDefined();
  });

  it('shows skeleton rows while the inbox loads', () => {
    state.conversations.isLoading = true;
    state.conversations.data = undefined;
    const el = mount(<MessagesScreen />);
    expect(el.querySelectorAll('div[data-animated="true"]').length).toBeGreaterThan(0);
    expect(button(el, 'Conversation with ana')).toBeNull();
  });

  it('offers Retry when the inbox fails to load', () => {
    state.conversations.isError = true;
    state.conversations.data = undefined;
    const el = mount(<MessagesScreen />);
    act(() => buttonWithText(el, 'Retry')!.click());
    expect(state.conversations.refetch).toHaveBeenCalled();
  });
});

// ─── 5. Thread ──────────────────────────────────────────────────────────

describe('Messages — thread', () => {
  const bubbleOf = (el: HTMLElement, text: string) =>
    Array.from(el.querySelectorAll('button')).find(
      b => b.getAttribute('aria-description') === 'Long press for options' && b.textContent?.includes(text),
    ) ?? Array.from(el.querySelectorAll('button')).find(b => b.textContent === text);

  it("puts the other person's avatar and name in the header, opening their profile", () => {
    const el = mount(<MessagesScreen />);
    openAna(el);
    const header = button(el, "View ana's profile")!;
    expect(header.textContent).toContain('Ana Silva');
    act(() => header.click());
    expect(mockPush).toHaveBeenCalledWith('/user/ana');
  });

  it('draws yours in ink with inverse text and theirs on the panel', () => {
    state.thread.data = [msg('m1', 'p-ana', 'hey'), msg('m2', 'p-me', 'hi back')];
    const el = mount(<MessagesScreen />);
    openAna(el);
    const theirs = bubbleOf(el, 'hey')!;
    const mine = bubbleOf(el, 'hi back')!;
    expect(theirs.style.backgroundColor).toBe(rgb(color.bgPanel));
    expect(mine.style.backgroundColor).toBe(rgb(color.text));
    expect(mine.style.maxWidth).toBe('75%');
  });

  it('shows "Sending…" under a pending message, then "Sent" once the server row lands', () => {
    state.thread.data = [msg('m1', 'p-ana', 'hey'), msg('temp-message-1', 'p-me', 'on my way')];
    const el = mount(<MessagesScreen />);
    openAna(el);
    expect(el.textContent).toContain('Sending…');

    state.thread.data = [msg('m1', 'p-ana', 'hey'), msg('m2', 'p-me', 'on my way')];
    rerender(<MessagesScreen />);
    expect(el.textContent).not.toContain('Sending…');
    expect(el.textContent).toContain('Sent · 14:30');
    // One copy only.
    expect(el.textContent!.split('on my way')).toHaveLength(2);
  });

  it('sends the typed message to the open conversation', () => {
    const el = mount(<MessagesScreen />);
    openAna(el);
    expect(button(el, 'Send')!.disabled).toBe(true);
    typeInto(el.querySelector('input[aria-label="Message"]') as HTMLInputElement, 'hello');
    act(() => button(el, 'Send')!.click());
    expect(mockSend).toHaveBeenCalledWith(
      { receiverId: 'p-ana', text: 'hello', replyTo: null },
      expect.any(Object),
    );
  });

  it('replies from the long-press sheet: banner above the composer, then the reply carries it', () => {
    const hey = msg('m1', 'p-ana', 'are you free?');
    state.thread.data = [hey];
    const el = mount(<MessagesScreen />);
    openAna(el);
    longPress(bubbleOf(el, 'are you free?')!);
    act(() => button(el, 'Reply')!.click());
    expect(el.textContent).toContain('Replying to @ana');

    typeInto(el.querySelector('input[aria-label="Message"]') as HTMLInputElement, 'yes');
    act(() => button(el, 'Send')!.click());
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'yes', replyTo: expect.objectContaining({ id: 'm1' }) }),
      expect.any(Object),
    );
    expect(el.textContent).not.toContain('Replying to');
  });

  it('renders a reply with an inset quote of the message it answers', () => {
    const original = msg('m1', 'p-ana', 'are you free?');
    state.thread.data = [original, msg('m2', 'p-me', 'yes', { reply_to: 'm1', repliedMessage: original })];
    const el = mount(<MessagesScreen />);
    openAna(el);
    const bubble = bubbleOf(el, 'yes')!;
    expect(bubble.textContent).toContain('@ana');
    expect(bubble.textContent).toContain('are you free?');
    const quote = Array.from(bubble.querySelectorAll('div')).find(d => d.style.borderLeftWidth === '2px');
    expect(quote).toBeDefined();
  });

  it('renders a shared post as a tappable card', () => {
    state.thread.data = [msg('m1', 'p-ana', '', { type: 'post_share', sharedPost })];
    const el = mount(<MessagesScreen />);
    openAna(el);
    const card = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('Kitchen install') && !b.getAttribute('aria-description'))!;
    act(() => card.click());
    expect(mockPush).toHaveBeenCalledWith('/post/post-9');
  });

  it('says hi when the thread is empty', () => {
    const el = mount(<MessagesScreen />);
    openAna(el);
    expect(el.textContent).toContain('Say hi to @ana');
  });

  it('goes back to the inbox from the header', () => {
    const el = mount(<MessagesScreen />);
    openAna(el);
    act(() => button(el, 'Back to messages')!.click());
    expect(button(el, 'Conversation with ana')).not.toBeNull();
  });
});

// ─── 6. Share picker ────────────────────────────────────────────────────

describe('Share picker', () => {
  const flush = () => act(async () => { await Promise.resolve(); });

  it('is titled "Send to" and previews the post being shared', async () => {
    mockParams.current = { id: 'post-9' };
    const el = mount(<SharePostScreen />);
    await flush();
    expect(el.querySelector('h1')!.textContent).toBe('Send to');
    expect(el.textContent).toContain('Kitchen install');
    expect(el.textContent).not.toContain('second line');
  });

  it('marks a row "Sent" once the post has gone to that person', async () => {
    mockParams.current = { id: 'post-9' };
    mockSearchUsers.mockImplementation(() =>
      Promise.resolve([{ id: 'p-ana', username: 'ana', full_name: 'Ana Silva', avatar_url: null }]),
    );
    const el = mount(<SharePostScreen />);
    await flush();
    typeInto(el.querySelector('input') as HTMLInputElement, 'an');
    await flush();

    const send = buttonWithText(el, 'Send')!;
    await act(async () => { send.click(); });
    expect(mockSendAsync).toHaveBeenCalledWith({ receiverId: 'p-ana', post: sharedPost });
    expect(buttonWithText(el, 'Sent')!.disabled).toBe(true);
  });
});
