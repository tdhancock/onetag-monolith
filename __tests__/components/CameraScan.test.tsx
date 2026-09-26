/**
 * @jest-environment jsdom
 */
//
// target: __tests__/components/CameraScan.test.tsx
//
// QR scanning on the camera tab (ONE-29), mounted. The fake CameraView keeps
// the props it was last given, so a test can play frames through
// onBarcodeScanned the way the native scanner does — the same code, many
// times a second:
//
//   * a Tag held in frame is offered exactly once, and never opened on its own;
//   * Open routes to /t/<shortCode>; dismissing re-arms detection;
//   * anything that is not a Tag — another host, plain text — does nothing;
//   * photo capture is untouched, and permission denial is the existing UI.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

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
const mockFocus: { effect: (() => void) | null } = { effect: null };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
  useFocusEffect: (effect: () => void) => { mockFocus.effect = effect; },
}), { virtual: true });

type ScannerProps = {
  onBarcodeScanned?: (result: { type: string; data: string }) => void;
  barcodeScannerSettings?: { barcodeTypes: string[] };
};
const camera = {
  permission: { granted: true, canAskAgain: true } as { granted: boolean; canAskAgain: boolean } | null,
  requestPermission: jest.fn(() => Promise.resolve()),
  takePictureAsync: jest.fn(() => Promise.resolve({ uri: 'file://shot.jpg', width: 3024, height: 4032 })),
  mounts: 0,
  props: {} as ScannerProps,
};
jest.mock('expo-camera', () => {
  const React = require('react');
  const CameraView = React.forwardRef((props: ScannerProps, ref: React.Ref<unknown>) => {
    camera.props = props;
    React.useEffect(() => { camera.mounts += 1; }, []);
    React.useImperativeHandle(ref, () => ({ takePictureAsync: camera.takePictureAsync }));
    return React.createElement('div', { 'data-camera': 'true' });
  });
  return { CameraView, useCameraPermissions: () => [camera.permission, camera.requestPermission] };
}, { virtual: true });

const mockApp = { addToast: jest.fn(), triggerHapticFeedback: jest.fn() };
jest.mock('../../store/AppContext.native', () => ({ useApp: () => mockApp }), { virtual: true });
jest.mock('../../features/profiles', () => ({
  useCurrentProfile: () => ({ profile: { username: 'me', profilePicture: null }, profileId: 'p-me' }),
}), { virtual: true });
jest.mock('../../features/stories', () => ({
  useUploadStory: () => ({ mutateAsync: jest.fn(() => Promise.resolve()) }),
}), { virtual: true });
jest.mock('../../services/mediaPicker', () => ({
  pickImageFromLibrary: () => Promise.resolve({ status: 'cancelled' }),
}), { virtual: true });

import CameraScreen from '../../app/(tabs)/camera';
import { buildTagUrl } from '../../lib/tagLinks';

const CODE = 'ABC23XYZ';
const TAG = buildTagUrl(CODE);

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
  camera.mounts = 0;
  camera.props = {};
  mockFocus.effect = null;
  [mockPush, mockNavigate, camera.requestPermission, camera.takePictureAsync, mockApp.addToast, mockApp.triggerHapticFeedback]
    .forEach((m) => m.mockClear());
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** Play `frames` reads of one value through the scanner, as the camera does while it is in view. */
function scan(value: string, frames = 1) {
  act(() => {
    for (let i = 0; i < frames; i += 1) camera.props.onBarcodeScanned?.({ type: 'qr', data: value });
  });
}

/** Play frames the way native does — straight from a handler captured before a re-render. */
function scanWithStaleHandler(value: string, frames: number) {
  const handler = camera.props.onBarcodeScanned!;
  act(() => {
    for (let i = 0; i < frames; i += 1) handler({ type: 'qr', data: value });
  });
}

const offers = (el: HTMLElement) =>
  (el.textContent?.match(/Tag detected/g) ?? []).length;
const buttonWithText = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement | undefined;
const buttonLabelled = (el: HTMLElement, label: string) =>
  el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;

// ─── The scanner ────────────────────────────────────────────────────────

describe('the scanner', () => {
  it('runs on the existing camera — one CameraView, looking for QR only', () => {
    mount();
    expect(camera.mounts).toBe(1);
    expect(camera.props.barcodeScannerSettings).toEqual({ barcodeTypes: ['qr'] });
    expect(camera.props.onBarcodeScanned).toBeInstanceOf(Function);
  });

  it('shows how to use it: a frame and a hint', () => {
    const el = mount();
    expect(el.textContent).toContain('Point at a tag to scan');
  });
});

// ─── Debounce ───────────────────────────────────────────────────────────

describe('a Tag held in frame', () => {
  it('is offered exactly once, not once per frame — and never opened on its own', () => {
    const el = mount();
    scan(TAG, 90); // three seconds at 30fps
    expect(offers(el)).toBe(1);
    expect(el.textContent).toContain(CODE);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockApp.triggerHapticFeedback).toHaveBeenCalledTimes(1);
  });

  it('ignores frames that arrive before the offer renders', () => {
    const el = mount();
    // The native scanner keeps calling the handler it holds; a state check
    // alone would let every one of these through.
    scanWithStaleHandler(TAG, 30);
    expect(offers(el)).toBe(1);
  });

  it('while offered, ignores the same code and any other Tag, and detaches the scanner', () => {
    const el = mount();
    const handler = camera.props.onBarcodeScanned!;
    scan(TAG);
    act(() => {
      handler({ type: 'qr', data: TAG });
      handler({ type: 'qr', data: buildTagUrl('XYZ23ABC') });
    });
    expect(offers(el)).toBe(1);
    expect(el.textContent).toContain(CODE);
    expect(el.textContent).not.toContain('XYZ23ABC');
    expect(camera.props.onBarcodeScanned).toBeUndefined();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// ─── Open and dismiss ───────────────────────────────────────────────────

describe('the offer', () => {
  it('Open routes to /t/<shortCode>, in one tap', () => {
    const el = mount();
    scan(TAG);
    act(() => buttonWithText(el, 'Open')!.click());
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(`/t/${CODE}`);
    expect(offers(el)).toBe(0);
  });

  it('after Open, the same code still in frame is not offered again — until the tab regains focus', () => {
    const el = mount();
    scan(TAG);
    act(() => buttonWithText(el, 'Open')!.click());
    scan(TAG, 10);
    expect(offers(el)).toBe(0);

    act(() => mockFocus.effect!());
    scan(TAG);
    expect(offers(el)).toBe(1);
  });

  it('dismissing re-arms detection: the same Tag is offered again', () => {
    const el = mount();
    scan(TAG);
    act(() => buttonLabelled(el, 'Dismiss tag')!.click());
    expect(offers(el)).toBe(0);
    expect(camera.props.onBarcodeScanned).toBeInstanceOf(Function);

    scan(TAG);
    expect(offers(el)).toBe(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// ─── Not a Tag ──────────────────────────────────────────────────────────

describe('a QR that is not a Tag', () => {
  it.each([
    ['a foreign host', 'https://evil.example/t/ABC23XYZ'],
    ['arbitrary text', 'Best before 2027-01-01'],
    ['a URL elsewhere', 'https://example.com/menu'],
  ])('does nothing for %s — no offer, no navigation, no error', (_what, value) => {
    const el = mount();
    const before = el.textContent;
    scan(value, 30);
    expect(offers(el)).toBe(0);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockApp.addToast).not.toHaveBeenCalled();
    expect(el.textContent).toBe(before);
  });
});

// ─── Capture ────────────────────────────────────────────────────────────

describe('photo capture', () => {
  it('works exactly as before with a Tag offered', async () => {
    const el = mount();
    scan(TAG);
    await act(async () => { buttonLabelled(el, 'Take photo')!.click(); });

    expect(camera.takePictureAsync).toHaveBeenCalledWith({ quality: 0.9 });
    expect(el.textContent).toContain('Share as OneSnap');
    expect(el.textContent).toContain('Share as post');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('is not interrupted by a Tag coming into frame while the photo is being shared', async () => {
    const el = mount();
    await act(async () => { buttonLabelled(el, 'Take photo')!.click(); });
    expect(camera.props.onBarcodeScanned).toBeUndefined();
    scan(TAG, 10);
    expect(offers(el)).toBe(0);
  });
});

// ─── Permission ─────────────────────────────────────────────────────────

describe('camera permission', () => {
  it('when denied, shows the existing denial UI and asks nothing more', () => {
    camera.permission = { granted: false, canAskAgain: true };
    const el = mount();
    expect(el.textContent).toContain('Allow camera access');
    expect(el.textContent).not.toContain('Point at a tag to scan');
    expect(camera.requestPermission).not.toHaveBeenCalled();
    expect(camera.mounts).toBe(0);
  });
});
