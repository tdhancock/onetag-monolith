//
// target: services/mediaPicker.ts
//
// The shared picker both the camera tab and the composer call (ONE-57).
// `expo-image-picker` is mocked so the native bridge is never exercised;
// what is under test is the wrapper's contract:
//
//   1. Library picks carry the images-only options and report the asset,
//      dimensions included, so ONE-55 can measure the aspect ratio once.
//   2. Cancellation and an empty asset list both collapse to `canceled`.
//   3. Camera capture requests permission first and reports a denial
//      distinctly, rather than silently doing nothing.

jest.mock('expo-image-picker', () => require('../support/expoImagePickerStub'));

import {
  launchImageLibraryAsync,
  launchCameraAsync,
  requestCameraPermissionsAsync,
  resetImagePickerMocks,
} from '../support/expoImagePickerStub';
import {
  pickImageFromLibrary,
  captureImageWithCamera,
} from '../../services/mediaPicker';

const anAsset = (overrides: Record<string, unknown> = {}) => ({
  uri: 'file:///tmp/photo.jpg',
  width: 1920,
  height: 1080,
  ...overrides,
});

beforeEach(resetImagePickerMocks);

// ---------------------------------------------------------------------------
// 1. Library
// ---------------------------------------------------------------------------

describe('pickImageFromLibrary', () => {
  it('launches the library restricted to images', async () => {
    launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: [] });

    await pickImageFromLibrary();

    const options = launchImageLibraryAsync.mock.calls[0][0];
    expect(options.mediaTypes).toEqual(['images']);
    expect(options.quality).toBe(0.9);
    expect(options.allowsEditing).toBe(true);
  });

  it('lets a caller override the shared options', async () => {
    launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: [] });

    await pickImageFromLibrary({ allowsEditing: false, aspect: [1, 1] });

    const options = launchImageLibraryAsync.mock.calls[0][0];
    expect(options.allowsEditing).toBe(false);
    expect(options.aspect).toEqual([1, 1]);
    // Overriding one option must not drop the rest.
    expect(options.mediaTypes).toEqual(['images']);
  });

  it('returns the selected asset with the dimensions the picker reported', async () => {
    launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [anAsset()],
    });

    const result = await pickImageFromLibrary();

    expect(result).toEqual({
      status: 'selected',
      media: {
        uri: 'file:///tmp/photo.jpg',
        width: 1920,
        height: 1080,
        mediaType: 'image',
      },
    });
  });

  it('nulls dimensions the picker did not report rather than inventing them', async () => {
    launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///tmp/a.jpg' }],
    });

    const result = await pickImageFromLibrary();

    expect(result).toEqual({
      status: 'selected',
      media: {
        uri: 'file:///tmp/a.jpg',
        width: null,
        height: null,
        mediaType: 'image',
      },
    });
  });

  it('reports cancellation', async () => {
    launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: [] });

    expect(await pickImageFromLibrary()).toEqual({ status: 'canceled' });
  });

  it('treats a non-cancelled result with no usable asset as cancelled', async () => {
    launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [] });

    expect(await pickImageFromLibrary()).toEqual({ status: 'canceled' });
  });
});

// ---------------------------------------------------------------------------
// 2. Camera
// ---------------------------------------------------------------------------

describe('captureImageWithCamera', () => {
  it('requests camera permission before opening the camera', async () => {
    requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: true });
    launchCameraAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [anAsset({ uri: 'file:///tmp/shot.jpg' })],
    });

    const result = await captureImageWithCamera();

    expect(requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 'selected',
      media: {
        uri: 'file:///tmp/shot.jpg',
        width: 1920,
        height: 1080,
        mediaType: 'image',
      },
    });
  });

  it('reports a denial distinctly and never opens the camera', async () => {
    requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: false });

    const result = await captureImageWithCamera();

    expect(result).toEqual({ status: 'permission-denied' });
    expect(launchCameraAsync).not.toHaveBeenCalled();
  });

  it('reports cancellation once the camera is open', async () => {
    requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: true });
    launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: [] });

    expect(await captureImageWithCamera()).toEqual({ status: 'canceled' });
  });
});
