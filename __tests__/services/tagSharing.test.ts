//
// target: __tests__/services/tagSharing.test.ts
//
// Getting a Tag off the phone (ONE-32, ONE-33): every link shared or copied
// is buildTagUrl(shortCode), in the form each platform's share sheet takes;
// a platform that cannot share a file gets the link instead; and an export
// the native renderer never finishes fails rather than hanging.

const mockPlatform = { OS: 'ios' };
const mockShare = jest.fn(() => Promise.resolve());
jest.mock('react-native', () => ({ Platform: mockPlatform, Share: { share: (...a: unknown[]) => mockShare(...(a as [])) } }));

const mockSetString = jest.fn(() => Promise.resolve(true));
jest.mock('expo-clipboard', () => ({ setStringAsync: (...a: unknown[]) => mockSetString(...(a as [])) }));

const mockSharing = { available: true, shareAsync: jest.fn(() => Promise.resolve()) };
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(mockSharing.available),
  shareAsync: (...a: unknown[]) => mockSharing.shareAsync(...(a as [])),
}));

jest.mock('expo-media-library', () => ({ requestPermissionsAsync: jest.fn(), Asset: { create: jest.fn() } }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    uri: string;
    constructor(dir: string, name: string) {
      this.uri = `${dir}/${name}`;
    }
    create() {}
    write() {}
  },
}));

import { copyTagLink, qrPngBase64, shareTagLink, shareTagQrImage } from '../../services/tagSharing';
import { buildTagUrl } from '../../lib/tagLinks';

beforeEach(() => {
  mockPlatform.OS = 'ios';
  mockSharing.available = true;
  [mockShare, mockSetString, mockSharing.shareAsync].forEach((m) => m.mockClear());
});

describe('the link', () => {
  it('copies buildTagUrl(shortCode)', async () => {
    await copyTagLink('ABC23XYZ');
    expect(mockSetString).toHaveBeenCalledWith(buildTagUrl('ABC23XYZ'));
  });

  it('shares it as a url on iOS and as text on Android', async () => {
    await shareTagLink('ABC23XYZ');
    expect(mockShare).toHaveBeenLastCalledWith({ url: buildTagUrl('ABC23XYZ') });
    mockPlatform.OS = 'android';
    await shareTagLink('ABC23XYZ');
    expect(mockShare).toHaveBeenLastCalledWith({ message: buildTagUrl('ABC23XYZ') });
  });
});

describe('the QR image', () => {
  it('shares the link instead where the platform cannot share a file', async () => {
    mockSharing.available = false;
    await shareTagQrImage('UE5H', 'ABC23XYZ');
    expect(mockSharing.shareAsync).not.toHaveBeenCalled();
    expect(mockShare).toHaveBeenCalledWith({ url: buildTagUrl('ABC23XYZ') });
  });

  it('fails an export the renderer throws on, rather than hanging', async () => {
    const svg = {
      toDataURL: () => {
        throw new Error('no native view');
      },
    };
    await expect(qrPngBase64(svg)).rejects.toThrow('no native view');
  });

  it('fails an export the renderer never finishes', async () => {
    jest.useFakeTimers();
    try {
      const pending = qrPngBase64({ toDataURL: () => undefined });
      jest.advanceTimersByTime(10_000);
      await expect(pending).rejects.toThrow('could not be rendered');
    } finally {
      jest.useRealTimers();
    }
  });
});
