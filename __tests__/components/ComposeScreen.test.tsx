/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/ComposeScreen.test.tsx
//
// The re-skinned composer (ONE-73), mounted: a white screen with your avatar
// beside the input and Post disabled; Post enabling as you type and
// disabling past 280 with a red ring and a negative count; the photo preview
// with its remove control; closing on success, and keeping the draft with an
// inline note when the photo fails to upload. And no poll anywhere (ONE-59).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

jest.mock('react-native', () => {
  const React = require('react');
  const shim = require('../support/reactNativeDom');
  const box = (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children);
  const scroll = (props: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-scroll': 'true' }, props.children);
  return {
    ...shim,
    KeyboardAvoidingView: box,
    ScrollView: scroll,
    Platform: { OS: 'ios' },
    Keyboard: { addListener: () => ({ remove: () => {} }) },
  };
}, { virtual: true });
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: (props: { children?: React.ReactNode; style?: unknown }) =>
      React.createElement('div', { 'data-screen': 'true', style: require('../support/reactNativeDom').flattenStyle(props.style) }, props.children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
  };
}, { virtual: true });
jest.mock('expo-image', () => {
  const React = require('react');
  return { Image: (props: { source?: { uri: string } }) => React.createElement('img', { src: props.source?.uri }) };
}, { virtual: true });
jest.mock('react-native-svg', () => {
  const React = require('react');
  const Svg = (props: { children?: React.ReactNode }) => React.createElement('svg', null, props.children);
  const Circle = (props: Record<string, unknown>) =>
    React.createElement('circle', { 'data-stroke': props.stroke, 'data-offset': String(props.strokeDashoffset ?? '') });
  const Path = () => React.createElement('path');
  return { __esModule: true, default: Svg, Svg, Circle, Path, G: Path, Rect: Path };
}, { virtual: true });

const mockBack = jest.fn();
const mockParams: { current: Record<string, string | undefined> } = { current: {} };
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => ({ addListener: () => () => {} }),
  Stack: { Screen: () => null },
}), { virtual: true });

// ─── 2. Mock the data layer ─────────────────────────────────────────────

const mockToast = jest.fn();
const mockApp = { addToast: mockToast };
jest.mock('../../store/AppContext.native', () => ({ useApp: () => mockApp }), { virtual: true });
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({
    profile: { username: 'me', name: 'Me Myself', profilePicture: null, isVerified: false },
    profileId: 'p-me',
  }),
}), { virtual: true });

const mockMutateAsync = jest.fn();
jest.mock('../../features/posts', () => ({
  useCreatePost: () => ({ mutateAsync: mockMutateAsync }),
}), { virtual: true });

jest.mock('../../services/mediaUpload', () => {
  class MediaUploadError extends Error {}
  return { MediaUploadError };
}, { virtual: true });

jest.mock('../../services/mediaPicker', () => ({
  pickImageFromLibrary: jest.fn(),
  captureImageWithCamera: jest.fn(),
  attachmentFromParams: (uri?: string) =>
    uri ? { uri, width: 1600, height: 900, mediaType: 'image' } : null,
  mediaAspectRatio: (media: { width: number; height: number } | null) => (media ? media.width / media.height : null),
  buildPostMedia: (media: { uri: string } | null) =>
    media ? { media: media.uri, media_type: 'image' } : { media_type: 'text' },
}), { virtual: true });

import ComposeScreen from '../../app/compose';
import { MediaUploadError } from '../../services/mediaUpload';
import { UPLOAD_FAILED_NOTE } from '../../components/native/ComposeMedia';
import { POST_MAX_CHARS } from '../../lib/screens/compose';
import { color } from '../../theme/tokens';

// ─── 3. Helpers ─────────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<ComposeScreen />));
  return container;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockParams.current = {};
  mockBack.mockClear();
  mockToast.mockClear();
  mockMutateAsync.mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  jest.useRealTimers();
});

const rgb = (hex: string) => {
  const probe = document.createElement('div');
  probe.style.color = hex;
  return probe.style.color;
};

const input = (el: HTMLElement) => el.querySelector('input[aria-label="Post text"]') as HTMLInputElement;
const postButton = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Post') as HTMLButtonElement;

function type(el: HTMLElement, text: string) {
  const field = input(el);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// ─── 4. Opening ─────────────────────────────────────────────────────────

describe('Compose — opening', () => {
  it('is a white screen with your avatar beside "What\'s happening?", and Post disabled', () => {
    const el = mount();
    const screen = el.querySelector('[data-screen]') as HTMLElement;
    expect(screen.style.backgroundColor).toBe(rgb(color.bg));
    expect(el.textContent).toContain('New post');
    expect(input(el).getAttribute('placeholder')).toBe("What's happening?");
    expect(postButton(el).disabled).toBe(true);
  });

  it('raises the keyboard once the modal has opened', () => {
    const el = mount();
    const field = input(el);
    expect(document.activeElement).not.toBe(field);
    act(() => { jest.runOnlyPendingTimers(); });
    expect(document.activeElement).toBe(field);
  });

  it('puts Add a photo directly under the text, in the page rather than pinned to the bottom edge', () => {
    // Pinned to the bottom, it sat under the keyboard. In the page, under
    // the draft, it stays in view above it.
    const el = mount();
    const photo = el.querySelector('[data-scroll] button[aria-label="Add a photo"]');
    expect(photo).not.toBeNull();
    expect(input(el).compareDocumentPosition(photo!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers no poll (ONE-59)', () => {
    const el = mount();
    expect(el.querySelector('button[aria-label="Add a poll"]')).toBeNull();
    expect(el.textContent).not.toMatch(/poll/i);
  });
});

// ─── 5. The counter ─────────────────────────────────────────────────────

describe('Compose — typing', () => {
  it('enables Post within the limit', () => {
    const el = mount();
    type(el, 'hello');
    expect(postButton(el).disabled).toBe(false);
  });

  it('past 280, turns the ring red, shows the negative remainder and disables Post', () => {
    const el = mount();
    type(el, 'x'.repeat(POST_MAX_CHARS + 3));
    expect(postButton(el).disabled).toBe(true);
    expect(el.textContent).toContain('-3');
    const strokes = Array.from(el.querySelectorAll('circle')).map(c => c.getAttribute('data-stroke'));
    expect(strokes).toContain(color.heart);
  });

  it('shows no count while there is room to spare', () => {
    const el = mount();
    type(el, 'hello');
    const counter = el.querySelector('[aria-label="5 of 280 characters"]');
    expect(counter).not.toBeNull();
    expect(counter!.textContent).toBe('');
  });
});

// ─── 6. The photo ───────────────────────────────────────────────────────

describe('Compose — a photo', () => {
  it('previews at its aspect ratio with a working remove control', () => {
    mockParams.current = { mediaUri: 'file:///photo.jpg' };
    const el = mount();
    expect(el.querySelector('img')?.getAttribute('src')).toBe('file:///photo.jpg');
    // With a photo, Post is live even without text.
    expect(postButton(el).disabled).toBe(false);

    act(() => (el.querySelector('button[aria-label="Remove photo"]') as HTMLButtonElement).click());
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('button[aria-label="Add a photo"]')).not.toBeNull();
  });
});

// ─── 7. Publishing ──────────────────────────────────────────────────────

describe('Compose — publishing', () => {
  it('closes once the post is published', async () => {
    mockMutateAsync.mockResolvedValue(undefined);
    const el = mount();
    type(el, 'hello');
    await act(async () => { postButton(el).click(); });
    expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ content: 'hello', media_type: 'text' }));
    expect(mockMutateAsync.mock.calls[0][0]).not.toHaveProperty('poll');
    act(() => { jest.runAllTimers(); });
    expect(mockBack).toHaveBeenCalled();
  });

  it('cannot publish twice while it closes', async () => {
    mockMutateAsync.mockResolvedValue(undefined);
    const el = mount();
    type(el, 'hello');
    await act(async () => { postButton(el).click(); });
    // Still on screen, before the close: Post stays busy.
    await act(async () => { postButton(el).click(); });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft, with the inline note, when the photo fails to upload', async () => {
    mockParams.current = { mediaUri: 'file:///photo.jpg' };
    mockMutateAsync.mockRejectedValue(new MediaUploadError('upload failed'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const el = mount();
    type(el, 'with a photo');
    await act(async () => { postButton(el).click(); });
    act(() => { jest.runAllTimers(); });

    expect(mockBack).not.toHaveBeenCalled();
    expect(input(el).value).toBe('with a photo');
    expect(el.querySelector('img')).not.toBeNull();
    const note = Array.from(el.querySelectorAll('span')).find(s => s.textContent === UPLOAD_FAILED_NOTE) as HTMLElement;
    expect(note).toBeDefined();
    expect(note.style.color).toBe(rgb(color.heart));
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('could not be uploaded'), 'error');
  });
});
