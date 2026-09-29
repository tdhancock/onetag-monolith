/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/EditPostScreen.test.tsx
//
// Edit post (ONE-73): Save waits for the server. It used to fire the update,
// toast "Post updated." and close in the same tick, so a save the server
// refused looked exactly like one it accepted and the edit was lost.
//
// And its tags (ONE-92): a photo post's tags are edited in the placer and
// saved as a difference, through the same Save. The placer and the picker
// are stubs here — each a row of buttons that call its callbacks — so the
// tests drive the screen, not the gestures (TagPlacer.test.tsx has those).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  const box = (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children);
  return { ...shim, ScrollView: box, Platform: { OS: 'ios' } };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
});
jest.mock('expo-image', () => require('../support/expoImageStub'));
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: 'post-1' }),
  Stack: { Screen: () => null },
}));

const mockToast = jest.fn();
jest.mock('../../store/AppContext.native', () => ({ useApp: () => ({ addToast: mockToast }) }));
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({ profile: { username: 'me', name: 'Me', profilePicture: null }, profileId: 'p-me' }),
  profileKeys: { all: ['profiles'] },
}));

const mockInvalidate = jest.fn();
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));

const mockMutateAsync = jest.fn();
const mockFetchPost = jest.fn();
/** What the screen writes its tag edits through, recorded in order. */
const mockWriter = {
  insert: jest.fn(async (tags: unknown[]) => tags.map((_t, i) => `t-new-${i}`)),
  move: jest.fn(async (_id: string, _x: number, _y: number) => true),
  remove: jest.fn(async (_id: string) => undefined),
};
const mockWriterFor = jest.fn((_postId: string, _ownerProfileId: string) => mockWriter);
// ComposeMedia's tag preview reaches the scan write; editing records none (ONE-46).
jest.mock('../../features/tags', () => ({
  useRecordScan: () => ({ mutate: jest.fn() }),
  embeddedTagWriter: (postId: string, ownerProfileId: string) => mockWriterFor(postId, ownerProfileId),
  tagKeys: { lists: () => ['tags', 'list'] },
}));
jest.mock('../../features/posts', () => ({
  useUpdatePost: () => ({ mutateAsync: mockMutateAsync }),
  usePostQuery: (id: string) =>
    require('../support/mockQuery').useMockQuery(`post:${id}`, () => mockFetchPost(id), Boolean(id)),
  postKeys: { all: ['posts'] },
}));

// The placer: one button per tag to move or remove it, and one to place a
// tag at 80, 80. The picker: a button that picks Ana.
jest.mock('../../components/native/TagPlacer', () => {
  const React = require('react');
  return (p: {
    tags: { key: string }[];
    onPlace: (x: number, y: number) => void;
    onMove: (key: string, x: number, y: number) => void;
    onRemove: (key: string) => void;
  }) =>
    React.createElement(
      'div',
      { 'data-placer': 'true' },
      React.createElement('button', { onClick: () => p.onPlace(80, 80) }, 'place'),
      ...p.tags.map((t) =>
        React.createElement(
          React.Fragment,
          { key: t.key },
          React.createElement('button', { onClick: () => p.onMove(t.key, 30, 40) }, `move ${t.key}`),
          React.createElement('button', { onClick: () => p.onRemove(t.key) }, `remove ${t.key}`),
        ),
      ),
    );
});
jest.mock('../../components/native/TagDestinationPicker', () => {
  const React = require('react');
  return (p: { visible: boolean; onPick: (d: unknown) => void }) =>
    p.visible
      ? React.createElement(
          'button',
          {
            onClick: () =>
              p.onPick({ kind: 'profile', profileId: 'p-ana', username: 'ana', profileType: 'individual', name: 'Ana', imageUrl: null }),
          },
          'pick ana',
        )
      : null;
});

import EditPostScreen from '../../app/edit-post';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<EditPostScreen />); });
  return container;
}

beforeEach(() => {
  mockBack.mockClear();
  mockToast.mockClear();
  mockInvalidate.mockClear();
  mockWriterFor.mockClear();
  Object.values(mockWriter).forEach(m => m.mockClear());
  mockMutateAsync.mockReset();
  mockFetchPost.mockResolvedValue({ id: 'post-1', content: 'first draft', media_type: 'text' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  (console.error as jest.Mock).mockRestore();
});

const input = (el: HTMLElement) => el.querySelector('input[aria-label="Post text"]') as HTMLInputElement;
const saveButton = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Save') as HTMLButtonElement;

function type(el: HTMLElement, text: string) {
  const field = input(el);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Edit post — saving', () => {
  it('keeps Save disabled until the text changes', async () => {
    const el = await mount();
    expect(input(el).value).toBe('first draft');
    expect(saveButton(el).disabled).toBe(true);
    type(el, 'second draft');
    expect(saveButton(el).disabled).toBe(false);
  });

  it('closes, and says so, once the server has saved it', async () => {
    mockMutateAsync.mockResolvedValue({ id: 'post-1', content: 'second draft' });
    const el = await mount();
    type(el, 'second draft');
    await act(async () => { saveButton(el).click(); });

    expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ id: 'post-1', content: 'second draft' }));
    expect(mockToast).toHaveBeenCalledWith('Post updated.', 'success');
    expect(mockBack).toHaveBeenCalled();
  });

  it('stays open with the edit intact when the save fails', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Could not save that post.'));
    const el = await mount();
    type(el, 'second draft');
    await act(async () => { saveButton(el).click(); });

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('Failed to update post.', 'error');
    expect(mockToast).not.toHaveBeenCalledWith('Post updated.', 'success');
    expect(input(el).value).toBe('second draft');
  });
});

// ─── Tags (ONE-92) ──────────────────────────────────────────────────────

const LAMP = { kind: 'product', productId: 'pd-1', name: 'Lamp', imageUrl: null };
const DOOR = { kind: 'product', productId: 'pd-2', name: 'Door', imageUrl: null };

const photoPost = (tagCount = 2) => ({
  id: 'post-1',
  content: 'first draft',
  username: 'me',
  media: 'https://example.test/p.jpg',
  media_type: 'image',
  media_aspect_ratio: 1,
  embeddedTags: [
    { id: 't-lamp', xPct: 10, yPct: 10, destination: LAMP },
    { id: 't-door', xPct: 60, yPct: 60, destination: DOOR },
    ...Array.from({ length: Math.max(0, tagCount - 2) }, (_, i) => ({ id: `t-${i}`, xPct: i, yPct: i, destination: LAMP })),
  ].slice(0, tagCount),
});

const buttonWithText = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find(b => b.textContent === text) as HTMLButtonElement | undefined;

const click = (el: HTMLElement, text: string) => act(() => buttonWithText(el, text)!.click());

describe('Edit post — tags', () => {
  it('offers no tagging on a text post', async () => {
    const el = await mount();
    expect(el.querySelector('[aria-label="Tag profiles, products or projects in this photo"]')).toBeNull();
    expect(el.querySelector('[data-placer]')).toBeNull();
  });

  it('opens the placer on the photo, seeded with its tags', async () => {
    mockFetchPost.mockResolvedValue(photoPost());
    const el = await mount();
    click(el, 'Tag');
    expect(el.querySelector('[data-placer]')).not.toBeNull();
    expect(buttonWithText(el, 'move t-lamp')).toBeDefined();
    expect(buttonWithText(el, 'move t-door')).toBeDefined();
  });

  it('saves a move, a removal and a new tag as one Save, keeping the moved tag\'s id', async () => {
    mockFetchPost.mockResolvedValue(photoPost());
    const el = await mount();
    click(el, 'Tag');
    expect(saveButton(el).disabled).toBe(true);

    click(el, 'move t-lamp');
    click(el, 'remove t-door');
    click(el, 'place');
    click(el, 'pick ana');
    expect(saveButton(el).disabled).toBe(false);

    await act(async () => { saveButton(el).click(); });

    expect(mockWriterFor).toHaveBeenCalledWith('post-1', 'p-me');
    expect(mockWriter.insert).toHaveBeenCalledWith([{ destination: { kind: 'profile', id: 'p-ana' }, xPct: 80, yPct: 80 }]);
    expect(mockWriter.move).toHaveBeenCalledWith('t-lamp', 30, 40);
    expect(mockWriter.remove).toHaveBeenCalledWith('t-door');
    // Inserts land before anything is removed.
    expect(mockWriter.insert.mock.invocationCallOrder[0]).toBeLessThan(mockWriter.remove.mock.invocationCallOrder[0]!);
    // The caption didn't change, so it isn't written.
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('Post updated.', 'success');
    expect(mockBack).toHaveBeenCalled();
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['posts'] });
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['profiles'] });
  });

  it('shows compose\'s limit message for an eleventh tag', async () => {
    const { Alert } = require('react-native');
    Alert.alert.mockClear();
    mockFetchPost.mockResolvedValue(photoPost(10));
    const el = await mount();
    click(el, 'Tag');
    click(el, 'place');
    expect(Alert.alert).toHaveBeenCalledWith('That’s the limit', expect.stringContaining('up to 10 tags'));
  });

  it('stays open, and reports nothing saved, when the tags fail to save', async () => {
    mockWriter.remove.mockRejectedValueOnce(new Error('network'));
    mockFetchPost.mockResolvedValue(photoPost());
    const el = await mount();
    click(el, 'Tag');
    click(el, 'remove t-door');
    await act(async () => { saveButton(el).click(); });

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('Failed to update post.', 'error');
    expect(mockToast).not.toHaveBeenCalledWith('Post updated.', 'success');
    // Still refetched: whatever landed shows everywhere the post does.
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['posts'] });
  });

  it('says a tag can\'t be placed when the database refuses it', async () => {
    mockWriter.insert.mockRejectedValueOnce({ code: '42501', message: 'row-level security' });
    mockFetchPost.mockResolvedValue(photoPost());
    const el = await mount();
    click(el, 'Tag');
    click(el, 'place');
    click(el, 'pick ana');
    await act(async () => { saveButton(el).click(); });

    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('can’t be placed'), 'error');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('writes the caption and the tags together when both changed', async () => {
    mockMutateAsync.mockResolvedValue({ id: 'post-1', content: 'second draft' });
    mockFetchPost.mockResolvedValue(photoPost());
    const el = await mount();
    type(el, 'second draft');
    click(el, 'Tag');
    click(el, 'move t-door');
    await act(async () => { saveButton(el).click(); });

    expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ content: 'second draft' }));
    expect(mockWriter.move).toHaveBeenCalledWith('t-door', 30, 40);
    expect(mockBack).toHaveBeenCalled();
  });
});
