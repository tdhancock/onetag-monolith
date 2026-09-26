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
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: (props: { children?: React.ReactNode; style?: unknown }) =>
      React.createElement('div', { 'data-screen': 'true', style: require('../support/reactNativeDom').flattenStyle(props.style) }, props.children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
  };
});
jest.mock('expo-image', () => {
  const React = require('react');
  return { Image: (props: { source?: { uri: string } }) => React.createElement('img', { src: props.source?.uri }) };
});
jest.mock('react-native-svg', () => {
  const React = require('react');
  const Svg = (props: { children?: React.ReactNode }) => React.createElement('svg', null, props.children);
  const Circle = (props: Record<string, unknown>) =>
    React.createElement('circle', { 'data-stroke': props.stroke, 'data-offset': String(props.strokeDashoffset ?? '') });
  const Path = () => React.createElement('path');
  return { __esModule: true, default: Svg, Svg, Circle, Path, G: Path, Rect: Path };
});

const mockBack = jest.fn();
const mockParams: { current: Record<string, string | undefined> } = { current: {} };
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => ({ addListener: () => () => {} }),
  Stack: { Screen: () => null },
}));

// ─── 2. Mock the data layer ─────────────────────────────────────────────

const mockToast = jest.fn();
const mockApp = { addToast: mockToast };
jest.mock('../../store/AppContext.native', () => ({ useApp: () => mockApp }));
const mockActing: { profile: Record<string, unknown>; profileId: string | undefined } = {
  profile: { username: 'me', name: 'Me Myself', profilePicture: null, isVerified: false, profileType: 'individual' },
  profileId: 'p-me',
};
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => mockActing,
}));

const mockMutateAsync = jest.fn();
jest.mock('../../features/posts', () => ({
  useCreatePost: () => ({ mutateAsync: mockMutateAsync }),
}));

// Embedded Tags (ONE-46). The picture's content rect is fixed — jsdom lays
// nothing out — as the 16:9 photo drawn 400×225; the preview overlay reports
// the tags it was given; the picker offers one product and one profile.
const mockCreateTags = jest.fn();
jest.mock('../../features/tags', () => ({
  useCreateEmbeddedTags: () => ({ mutateAsync: mockCreateTags }),
}));
jest.mock('../../components/native/EmbeddedTags', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: { tags: unknown[]; interactive?: boolean }) =>
      React.createElement('div', { 'data-embedded-tags': String(props.tags.length), 'data-interactive': String(props.interactive) }),
    useImageContentRect: () => ({ contentRect: { x: 0, y: 0, width: 400, height: 225 }, onLayout: () => {}, onLoad: () => {} }),
  };
});
jest.mock('../../components/native/TagDestinationPicker', () => {
  const React = require('react');
  const LAMP = { kind: 'product', productId: 'pd-1', name: 'Lamp', imageUrl: null };
  const STUDIO = { kind: 'profile', profileId: 'p-other', username: 'studio', profileType: 'business', name: 'Studio', imageUrl: null };
  return {
    __esModule: true,
    default: (props: { visible: boolean; onPick: (d: unknown) => void; onClose: () => void }) =>
      props.visible
        ? React.createElement(
            'div',
            { 'data-picker': 'true' },
            React.createElement('button', { onClick: () => props.onPick(LAMP) }, 'Pick Lamp'),
            React.createElement('button', { onClick: () => props.onPick(STUDIO) }, 'Pick Studio'),
            React.createElement('button', { onClick: props.onClose }, 'Close picker'),
          )
        : null,
  };
});

jest.mock('../../services/mediaUpload', () => {
  class MediaUploadError extends Error {}
  return { MediaUploadError };
});

jest.mock('../../services/mediaPicker', () => ({
  pickImageFromLibrary: jest.fn(),
  captureImageWithCamera: jest.fn(),
  attachmentFromParams: (uri?: string) =>
    uri ? { uri, width: 1600, height: 900, mediaType: 'image' } : null,
  mediaAspectRatio: (media: { width: number; height: number } | null) => (media ? media.width / media.height : null),
  buildPostMedia: (media: { uri: string } | null) =>
    media ? { media: media.uri, media_type: 'image' } : { media_type: 'text' },
}));

import { Alert } from 'react-native';
import ComposeScreen from '../../app/compose';
import { TAG_LIMIT_MESSAGE, TAGS_FAILED_TITLE } from '../../lib/screens/composeTags';
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
  mockCreateTags.mockReset();
  (Alert.alert as jest.Mock).mockClear();
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

  it('shows which profile the post will publish as, before it is published (ONE-25)', () => {
    const el = mount();
    const indicator = el.querySelector('[aria-label="Posting as @me, individual profile"]');
    expect(indicator).not.toBeNull();
    expect(indicator!.textContent).toContain('@me');
    expect(indicator!.textContent).toContain('INDIVIDUAL');
    // Above the draft, where it is read before Post is tapped.
    expect(indicator!.compareDocumentPosition(input(el)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the business profile when that is the one being acted as', () => {
    const previous = { ...mockActing };
    mockActing.profile = { username: 'me_studio', name: 'Me Studio', profilePicture: null, profileType: 'business' };
    mockActing.profileId = 'p-biz';
    try {
      const el = mount();
      const indicator = el.querySelector('[aria-label="Posting as @me_studio, business profile"]');
      expect(indicator!.textContent).toContain('BUSINESS');
    } finally {
      Object.assign(mockActing, previous);
    }
  });

  it('names no profile before the real one has loaded', () => {
    const previous = { ...mockActing };
    mockActing.profile = { username: 'onetag_user', name: 'OneTag User', profilePicture: null };
    mockActing.profileId = undefined;
    try {
      const el = mount();
      expect(el.querySelector('[aria-label^="Posting as"]')).toBeNull();
      expect(el.textContent).not.toContain('Posting as');
    } finally {
      Object.assign(mockActing, previous);
    }
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

// ─── 8. Embedded Tags (ONE-46) ──────────────────────────────────────────

const button = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find(b => b.textContent === text) as HTMLButtonElement | undefined;

function tapPhoto(el: HTMLElement, x: number, y: number) {
  const surface = el.querySelector('[data-testid="tag-placer-surface"]') as HTMLElement;
  const event = new MouseEvent('click', { bubbles: true });
  Object.defineProperty(event, 'locationX', { value: x });
  Object.defineProperty(event, 'locationY', { value: y });
  act(() => { surface.dispatchEvent(event); });
}

/** Open tagging if it isn't, tap the photo, and pick a destination. */
function tagAt(el: HTMLElement, x: number, y: number, pick = 'Pick Lamp') {
  if (!el.querySelector('[data-testid="tag-placer-surface"]')) act(() => button(el, 'Tag')!.click());
  tapPhoto(el, x, y);
  act(() => button(el, pick)!.click());
}

describe('Compose — tagging', () => {
  it('offers no tagging step on a text-only post', () => {
    const el = mount();
    type(el, 'just words');
    expect(button(el, 'Tag')).toBeUndefined();
  });

  it('places a tag where the photo is tapped and opens the picker', () => {
    mockParams.current = { mediaUri: 'file:///photo.jpg' };
    const el = mount();
    act(() => button(el, 'Tag')!.click());
    tapPhoto(el, 200, 112.5);

    expect(el.querySelector('[data-picker]')).not.toBeNull();
    act(() => button(el, 'Pick Lamp')!.click());
    expect(el.querySelector('[data-picker]')).toBeNull();
    expect(el.textContent).toContain('Lamp');
    expect(el.textContent).toContain('1 / 10 TAGGED');
  });

  it('drops a newly placed tag when its picker closes without a choice', () => {
    mockParams.current = { mediaUri: 'file:///photo.jpg' };
    const el = mount();
    act(() => button(el, 'Tag')!.click());
    tapPhoto(el, 10, 10);
    act(() => button(el, 'Close picker')!.click());
    expect(el.textContent).toContain('0 / 10 TAGGED');
  });

  it('previews the tags through the same overlay viewers get, without taps', () => {
    mockParams.current = { mediaUri: 'file:///photo.jpg' };
    const el = mount();
    tagAt(el, 100, 100);
    tagAt(el, 300, 50, 'Pick Studio');
    act(() => button(el, 'Done')!.click());

    const preview = el.querySelector('[data-embedded-tags]') as HTMLElement;
    expect(preview.getAttribute('data-embedded-tags')).toBe('2');
    expect(preview.getAttribute('data-interactive')).toBe('false');
  });

  it('prevents an eleventh tag, and says why', () => {
    mockParams.current = { mediaUri: 'file:///photo.jpg' };
    const el = mount();
    for (let i = 0; i < 10; i += 1) tagAt(el, 20 * i, 20);
    tapPhoto(el, 390, 200);

    expect(el.querySelector('[data-picker]')).toBeNull();
    expect(Alert.alert).toHaveBeenCalledWith(expect.any(String), TAG_LIMIT_MESSAGE);
    expect(el.textContent).toContain('10 / 10 TAGGED');
  });

  it('publishes the post, then its tags against the new post id, as the author', async () => {
    mockParams.current = { mediaUri: 'file:///photo.jpg' };
    mockMutateAsync.mockResolvedValue({ id: 'post-1' });
    mockCreateTags.mockResolvedValue(undefined);
    const el = mount();
    tagAt(el, 200, 112.5);
    tagAt(el, 0, 0, 'Pick Studio');
    tagAt(el, 400, 225);

    await act(async () => { postButton(el).click(); });
    act(() => { jest.runAllTimers(); });

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockCreateTags).toHaveBeenCalledTimes(1);
    expect(mockCreateTags).toHaveBeenCalledWith({
      hostPostId: 'post-1',
      ownerProfileId: 'p-me',
      tags: [
        { destination: { kind: 'product', id: 'pd-1' }, xPct: 50, yPct: 50 },
        { destination: { kind: 'profile', id: 'p-other' }, xPct: 0, yPct: 0 },
        { destination: { kind: 'product', id: 'pd-1' }, xPct: 100, yPct: 100 },
      ],
    });
    expect(mockBack).toHaveBeenCalled();
  });

  it('keeps the post when its tags fail, says so, and retries', async () => {
    mockParams.current = { mediaUri: 'file:///photo.jpg' };
    mockMutateAsync.mockResolvedValue({ id: 'post-1' });
    mockCreateTags.mockRejectedValueOnce(new Error('rls')).mockResolvedValueOnce(undefined);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const el = mount();
    tagAt(el, 200, 112.5);

    await act(async () => { postButton(el).click(); });

    // Told the post is up and its tags aren't — never "nothing was posted".
    const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe(TAGS_FAILED_TITLE);
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();

    const retry = (buttons as { text: string; onPress: () => void }[]).find(b => b.text === 'Try again')!;
    await act(async () => { retry.onPress(); });
    act(() => { jest.runAllTimers(); });

    expect(mockCreateTags).toHaveBeenCalledTimes(2);
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalled();
  });

  it('publishes a photo post with no tags exactly as before', async () => {
    mockParams.current = { mediaUri: 'file:///photo.jpg' };
    mockMutateAsync.mockResolvedValue({ id: 'post-1' });
    const el = mount();
    await act(async () => { postButton(el).click(); });
    act(() => { jest.runAllTimers(); });

    expect(mockCreateTags).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
  });

  it('forgets the tags when the photo is removed', () => {
    mockParams.current = { mediaUri: 'file:///photo.jpg' };
    const el = mount();
    tagAt(el, 200, 112.5);
    act(() => button(el, 'Done')!.click());
    act(() => (el.querySelector('button[aria-label="Remove photo"]') as HTMLButtonElement).click());
    expect(button(el, 'Tag')).toBeUndefined();
    expect(el.querySelector('[data-embedded-tags]')).toBeNull();
  });
});
