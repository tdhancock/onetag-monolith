
//
// target: __tests__/services/media-upload-errors.test.ts
//
// How the post and OneSnap uploaders fail:
//   1. Network timeout — fetch rejects with an AbortError (the shape a
//      timeout/abort produces) and the caller sees the error propagate.
//   2. 500 server error — fetch resolves with ok:false / status 500 and
//      uploadMedia throws a descriptive error containing the status.
//   3. Network error propagation — a TypeError from fetch (the shape the
//      WHATWG fetch spec throws for a DNS/unreachable failure) propagates.
//   4. A refused upload throws a MediaUploadError after one attempt, in one
//      bucket at one path (ONE-100). No other buckets or paths are tried, and
//      nothing falls back to an inline data: URL.
//
// The offline-queue cases that used to sit here went with services/
// offlineQueue.ts, which no app code imported (ONE-20).

const mockUpload = jest.fn();
const mockStorageFrom = jest.fn();

// --- Mock the Supabase native client so services/mediaUpload.ts can be imported ---
// in a pure-Node Jest environment without pulling in AsyncStorage / expo.
jest.mock('../../services/supabase.native', () => ({
  supabase: {
    from: jest.fn(),
    storage: {
      from: (bucket: string) => {
        mockStorageFrom(bucket);
        return {
          upload: (...args: unknown[]) => mockUpload(...args),
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example.test/${bucket}/${path}` } }),
        };
      },
    },
  },
}));

import { MediaUploadError, POST_MEDIA_BUCKET, uploadMedia } from '../../services/mediaUpload';
import { uploadStoryMedia } from '../../services/storyUpload';

describe('API error response handling', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    // Restore the real fetch between tests so mocks never leak.
    global.fetch = originalFetch;
  });

  // 1. Network timeout ------------------------------------------------------
  it('propagates a network timeout (AbortError) from fetch', async () => {
    const timeoutError = new Error('The operation was aborted');
    timeoutError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(timeoutError) as unknown as typeof fetch;

    await expect(uploadMedia('file:///tmp/photo.jpg', 'user-1')).rejects.toThrow(/aborted/);
  });

  // 2. 500 server error -----------------------------------------------------
  it('throws a descriptive error on a 500 server error response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as unknown as Response) as unknown as typeof fetch;

    await expect(uploadMedia('file:///tmp/photo.jpg', 'user-1')).rejects.toThrow(/500/);
  });

  // 3. Network error propagation (DNS / unreachable) -----------------------
  it('propagates a low-level network error (TypeError) from fetch', async () => {
    const networkError = new TypeError('Network request failed');
    global.fetch = jest.fn().mockRejectedValue(networkError) as unknown as typeof fetch;

    await expect(uploadMedia('file:///tmp/photo.jpg', 'user-1')).rejects.toThrow(/Network request failed/);
  });
});

// 4. A refused upload ---------------------------------------------------------
describe('a refused upload', () => {
  const originalFetch = global.fetch;
  const refusal = { message: 'new row violates row-level security policy' };

  beforeEach(() => {
    mockUpload.mockReset();
    mockStorageFrom.mockReset();
    mockUpload.mockResolvedValue({ error: refusal });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as unknown as Response) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fails a post photo once, in post-media under the account, with a MediaUploadError', async () => {
    const failure = await uploadMedia('file:///tmp/photo.png', 'user-1').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MediaUploadError);
    expect((failure as MediaUploadError).cause).toBe(refusal);
    expect(mockStorageFrom.mock.calls).toEqual([[POST_MEDIA_BUCKET]]);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0][0]).toMatch(/^user-1\/posts\/[^/]+\.png$/);
  });

  it('fails a OneSnap photo once, in post-media under the account, with a MediaUploadError', async () => {
    const failure = await uploadStoryMedia(new Blob(['x'], { type: 'image/jpeg' }), 'user-1').catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(MediaUploadError);
    expect(mockStorageFrom.mock.calls).toEqual([[POST_MEDIA_BUCKET]]);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0][0]).toMatch(/^user-1\/stories\/[^/]+\.jpg$/);
  });

  it('returns the public URL when the upload goes through', async () => {
    mockUpload.mockResolvedValue({ error: null });
    const url = await uploadStoryMedia(new Blob(['x'], { type: 'image/jpeg' }), 'user-1');
    expect(url).toMatch(/^https:\/\/storage\.example\.test\/post-media\/user-1\/stories\/[^/]+\.jpg$/);
  });
});
