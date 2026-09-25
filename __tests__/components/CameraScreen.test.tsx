/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/CameraScreen.test.tsx
//
// The camera tab, re-skinned (ONE-74), mounted: white controls over the
// full-bleed viewfinder, the light "Share as" sheet that replaced the Alert
// (each row doing what the Alert's option did), the permission EmptyState
// with Allow / Open settings, and the OneSnap upload panel.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

// ─── 1. Mock the native runtime ─────────────────────────────────────────

jest.mock('react-native', () => {
  const shim = require('../support/reactNativeDom');
  return { ...shim, Linking: { openSettings: jest.fn(() => Promise.resolve()) } };
}, { virtual: true });
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: (p: { children?: React.ReactNode }) => React.createElement('div', null, p.children) };
}, { virtual: true });
jest.mock('expo-image', () => require('../support/expoImageStub'), { virtual: true });
jest.mock('react-native-svg', () => require('../support/reactNativeSvgStub'), { virtual: true });

const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, navigate: mockNavigate }) }), { virtual: true });

const camera = {
  permission: { granted: true, canAskAgain: true } as { granted: boolean; canAskAgain: boolean } | null,
  requestPermission: jest.fn(() => Promise.resolve()),
  takePictureAsync: jest.fn(() => Promise.resolve({ uri: 'file://shot.jpg', width: 3024, height: 4032 })),
};
jest.mock('expo-camera', () => {
  const React = require('react');
  const CameraView = React.forwardRef((_p: unknown, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({ takePictureAsync: camera.takePictureAsync }));
    return React.createElement('div', { 'data-camera': 'true' });
  });
  return { CameraView, useCameraPermissions: () => [camera.permission, camera.requestPermission] };
}, { virtual: true });

// ─── 2. Mock the data layer ─────────────────────────────────────────────

const mockApp = { addToast: jest.fn(), triggerHapticFeedback: jest.fn() };
jest.mock('../../store/AppContext.native', () => ({ useApp: () => mockApp }), { virtual: true });
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({ profile: { username: 'me', profilePicture: null }, profileId: 'p-me' }),
}), { virtual: true });
const upload = { resolve: () => {} };
const mockUpload = jest.fn(
  (_input: unknown) => new Promise<void>((resolve) => { upload.resolve = resolve; }),
);
jest.mock('../../features/stories', () => ({
  useUploadStory: () => ({ mutateAsync: mockUpload }),
}), { virtual: true });
const mockPick = jest.fn(() =>
  Promise.resolve({ status: 'selected', media: { uri: 'file://library.jpg', width: 1080, height: 1350 } } as unknown),
);
jest.mock('../../services/mediaPicker', () => ({ pickImageFromLibrary: () => mockPick() }), { virtual: true });

import CameraScreen from '../../app/(tabs)/camera';
import { Linking } from 'react-native';
import { color } from '../../theme/tokens';

// ─── 3. Helpers ─────────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<CameraScreen />));
  return container;
}

beforeEach(() => {
  camera.permission = { granted: true, canAskAgain: true };
  [mockPush, mockNavigate, mockUpload, mockPick, camera.requestPermission, camera.takePictureAsync, mockApp.addToast].forEach(m => m.mockClear());
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

const rgb = (hex: string) => {
  const probe = document.createElement('div');
  probe.style.color = hex;
  return probe.style.color;
};

const capture = async (el: HTMLElement) => {
  await act(async () => { button(el, 'Take photo')!.click(); });
};

// ─── 4. Viewfinder ──────────────────────────────────────────────────────

describe('Camera — viewfinder', () => {
  it('draws a white 72pt ring shutter over the full-bleed camera', () => {
    const el = mount();
    expect(el.querySelector('div[data-camera="true"]')).not.toBeNull();
    const shutter = button(el, 'Take photo')!;
    expect(shutter.style.width).toBe('72px');
    expect(shutter.style.borderWidth).toBe('3px');
    expect(rgb(shutter.style.borderColor)).toBe(rgb(color.inverse));
    const fill = shutter.querySelector('div')!;
    expect(fill.style.width).toBe('58px');
    expect(fill.style.backgroundColor).toBe(rgb(color.inverse));
  });

  it('puts Library and Flip on translucent dark squares, with no close button', () => {
    const el = mount();
    for (const label of ['Choose from library', 'Flip camera']) {
      const control = button(el, label)!;
      expect(control.style.width).toBe('44px');
      expect(control.style.backgroundColor).toMatch(/^rgba\(10, 10, 10, 0\.4\)$/);
    }
    expect(button(el, 'Close')).toBeNull();
  });
});

// ─── 5. After a capture ─────────────────────────────────────────────────

describe('Camera — share sheet', () => {
  it('offers "Share as OneSnap" and "Share as post" once a photo is taken', async () => {
    const el = mount();
    await capture(el);
    expect(button(el, 'Share as OneSnap')).not.toBeNull();
    expect(button(el, 'Share as post')).not.toBeNull();
    expect(el.textContent).not.toMatch(/\bStory\b/);
  });

  it('"Share as post" opens Compose with the photo and its dimensions, as the Alert did', async () => {
    const el = mount();
    await capture(el);
    act(() => button(el, 'Share as post')!.click());
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/compose',
      params: { mediaUri: 'file://shot.jpg', mediaType: 'image', mediaWidth: '3024', mediaHeight: '4032' },
    });
    expect(button(el, 'Share as post')).toBeNull();
  });

  it('"Share as OneSnap" uploads it, with a small ink "Uploading OneSnap…" panel meanwhile', async () => {
    const el = mount();
    await capture(el);
    await act(async () => { button(el, 'Share as OneSnap')!.click(); });
    expect(mockUpload).toHaveBeenCalledWith({ imageUri: 'file://shot.jpg', caption: null });
    const label = Array.from(el.querySelectorAll('span')).find(s => s.textContent === 'Uploading OneSnap…')!;
    expect(label).toBeDefined();
    expect((label.parentElement as HTMLElement).style.backgroundColor).toBe(rgb(color.text));
    expect(mockApp.addToast).toHaveBeenCalledWith('Uploading OneSnap…', 'info');
    await act(async () => { upload.resolve(); });
  });

  it('offers the same choice for a photo picked from the library', async () => {
    const el = mount();
    await act(async () => { button(el, 'Choose from library')!.click(); });
    act(() => button(el, 'Share as post')!.click());
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ mediaUri: 'file://library.jpg' }) }),
    );
  });

  it('Cancel dismisses the sheet and does nothing else', async () => {
    const el = mount();
    await capture(el);
    act(() => buttonWithText(el, 'Cancel')!.click());
    expect(button(el, 'Share as post')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

// ─── 6. Permission ──────────────────────────────────────────────────────

describe('Camera — permission', () => {
  it('asks for access on a light EmptyState', () => {
    camera.permission = { granted: false, canAskAgain: true };
    const el = mount();
    expect(el.textContent).toContain('Allow camera access');
    expect(el.textContent).toContain('OneTag uses the camera for photos and OneSnaps');
    act(() => buttonWithText(el, 'Allow access')!.click());
    expect(camera.requestPermission).toHaveBeenCalled();
    expect(el.querySelector('div[data-camera="true"]')).toBeNull();
  });

  it('sends a permanent denial to Settings instead', () => {
    camera.permission = { granted: false, canAskAgain: false };
    const el = mount();
    expect(buttonWithText(el, 'Allow access')).toBeUndefined();
    act(() => buttonWithText(el, 'Open settings')!.click());
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it('still lets you choose from the library', () => {
    camera.permission = { granted: false, canAskAgain: true };
    const el = mount();
    expect(buttonWithText(el, 'Choose from library')).toBeDefined();
  });
});
