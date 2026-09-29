//
// target: __tests__/services/tagSharing.test.ts
//
// Getting a Tag off the phone (ONE-32, ONE-33): every link shared or copied
// is buildTagUrl(shortCode), in the form each platform's share sheet takes;
// the image shared is the tag's print-resolution PNG, written as bytes; and a
// platform that cannot share a file gets the link instead.

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

const mockWritten: { uri: string; args: unknown[] }[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    uri: string;
    constructor(dir: string, name: string) {
      this.uri = `${dir}/${name}`;
    }
    create() {}
    write(...args: unknown[]) {
      mockWritten.push({ uri: this.uri, args });
    }
  },
}));

import { copyTagLink, shareTagLink, shareTagQrImage } from '../../services/tagSharing';
import { buildTagUrl } from '../../lib/tagLinks';
import { tagQrPng } from '../../lib/tagQr';

beforeEach(() => {
  mockPlatform.OS = 'ios';
  mockSharing.available = true;
  mockWritten.length = 0;
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
  it("shares the tag's print-resolution PNG, written as bytes", async () => {
    await shareTagQrImage('ABC23XYZ');
    expect(mockWritten).toEqual([{ uri: 'file:///cache/onetag-ABC23XYZ.png', args: [tagQrPng('ABC23XYZ').png] }]);
    expect(mockSharing.shareAsync).toHaveBeenCalledWith(
      'file:///cache/onetag-ABC23XYZ.png',
      expect.objectContaining({ mimeType: 'image/png' }),
    );
  });

  it('shares the link instead where the platform cannot share a file', async () => {
    mockSharing.available = false;
    await shareTagQrImage('ABC23XYZ');
    expect(mockSharing.shareAsync).not.toHaveBeenCalled();
    expect(mockWritten).toHaveLength(0);
    expect(mockShare).toHaveBeenCalledWith({ url: buildTagUrl('ABC23XYZ') });
  });
});
