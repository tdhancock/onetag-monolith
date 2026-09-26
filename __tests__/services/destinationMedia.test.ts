//
// target: __tests__/services/destinationMedia.test.ts
//
// A Product's or Project's images (ONE-40, ONE-41) go into post-media under
// the folder for their kind and then the *account's* id — the path storage
// RLS accepts. A profile id there is refused for every profile made after
// signup, so the tests use an account and a profile whose ids differ.
//
//   1. The path is `<folder>/<auth user id>/<unique>.<ext>`, never profile-keyed.
//   2. The upload goes to post-media once, and its public URL comes back.
//   3. A failed upload or unreadable file throws; nothing falls back to a
//      data: URL, which would render on one device only.
//   4. A mixed list uploads only what is still on the device, in order.

const mockUpload = jest.fn();
const mockGetPublicUrl = jest.fn();
const mockBucket = jest.fn();

jest.mock('../../services/supabase.native', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        mockBucket(bucket);
        return {
          upload: (...args: unknown[]) => mockUpload(...args),
          getPublicUrl: (...args: unknown[]) => mockGetPublicUrl(...args),
        };
      },
    },
  },
}));

const mockReadLocalFile = jest.fn();
jest.mock('../../services/localFile', () => ({
  readLocalFile: (...args: unknown[]) => mockReadLocalFile(...args),
}));

import {
  destinationMediaPath,
  uploadDestinationImage,
  uploadDeviceImages,
} from '../../services/destinationMedia';
import { MediaUploadError } from '../../services/mediaUpload';
import { asAuthUserId } from '../../types';

const ACCOUNT = asAuthUserId('11111111-1111-1111-1111-111111111111');
// The business profile the product belongs to: not the account's id.
const BUSINESS_PROFILE = '22222222-2222-2222-2222-222222222222';
const LOCAL = 'file:///var/mobile/photo.png';

beforeEach(() => {
  jest.clearAllMocks();
  mockReadLocalFile.mockResolvedValue({ arrayBuffer: new ArrayBuffer(4), contentType: 'image/png', ext: 'png' });
  mockUpload.mockResolvedValue({ error: null });
  mockGetPublicUrl.mockImplementation((path: string) => ({
    data: { publicUrl: `https://cdn.example/post-media/${path}` },
  }));
});

describe('the storage path', () => {
  it('is the folder, then the account, then a unique name', () => {
    expect(destinationMediaPath('products', ACCOUNT, 'jpg', 'abc')).toBe(`products/${ACCOUNT}/abc.jpg`);
    expect(destinationMediaPath('projects', ACCOUNT, 'png', 'xyz')).toBe(`projects/${ACCOUNT}/xyz.png`);
  });

  it('makes a different name each time, so two photos never collide', () => {
    expect(destinationMediaPath('products', ACCOUNT, 'jpg')).not.toBe(destinationMediaPath('products', ACCOUNT, 'jpg'));
  });
});

describe('uploading an image', () => {
  it('puts it in post-media under the account, and returns its public URL', async () => {
    const url = await uploadDestinationImage(LOCAL, ACCOUNT, 'products');

    expect(mockBucket).toHaveBeenCalledWith('post-media');
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [path, body, options] = mockUpload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^products/${ACCOUNT}/[\\w-]+\\.png$`));
    expect(path).not.toContain(BUSINESS_PROFILE);
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect(options).toEqual({ cacheControl: '3600', upsert: false, contentType: 'image/png' });
    expect(url).toBe(`https://cdn.example/post-media/${path}`);
  });

  it('throws when storage refuses it, and tries no other path', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'new row violates row-level security policy' } });

    await expect(uploadDestinationImage(LOCAL, ACCOUNT, 'projects')).rejects.toBeInstanceOf(MediaUploadError);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockGetPublicUrl).not.toHaveBeenCalled();
  });

  it('throws when the file cannot be read, before any upload', async () => {
    mockReadLocalFile.mockRejectedValue(new Error('Failed to read local file: 404'));

    await expect(uploadDestinationImage(LOCAL, ACCOUNT, 'products')).rejects.toBeInstanceOf(MediaUploadError);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('a list of images, some new and some stored', () => {
  it('uploads only the ones on the device and keeps the order', async () => {
    const stored = 'https://cdn.example/post-media/products/old.jpg';
    const urls = await uploadDeviceImages([stored, LOCAL, 'content://media/2'], ACCOUNT, 'products');

    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(urls[0]).toBe(stored);
    expect(urls[1]).toMatch(new RegExp(`^https://cdn\\.example/post-media/products/${ACCOUNT}/`));
    expect(urls[2]).toMatch(new RegExp(`^https://cdn\\.example/post-media/products/${ACCOUNT}/`));
  });

  it('fails as a whole when one upload fails, so nothing half-saved is written', async () => {
    mockUpload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'boom' } });

    await expect(uploadDeviceImages([LOCAL, LOCAL], ACCOUNT, 'products')).rejects.toBeInstanceOf(MediaUploadError);
  });
});
