
//
// target: __tests__/services/media-upload-errors.test.ts
//
// Transport-level failures on the post media upload path (`uploadMedia`):
//   1. Network timeout — fetch rejects with an AbortError (the shape a
//      timeout/abort produces) and the caller sees the error propagate.
//   2. 500 server error — fetch resolves with ok:false / status 500 and
//      uploadMedia throws a descriptive error containing the status.
//   3. Network error propagation — a TypeError from fetch (the shape the
//      WHATWG fetch spec throws for a DNS/unreachable failure) propagates.
//
// The offline-queue cases that used to sit here went with services/
// offlineQueue.ts, which no app code imported (ONE-20).

// --- Mock the Supabase native client so services/mediaUpload.ts can be imported ---
// in a pure-Node Jest environment without pulling in AsyncStorage / expo.
jest.mock('../../services/supabase.native', () => ({
  supabase: {
    from: jest.fn(),
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn(),
        getPublicUrl: jest.fn(() => ({ data: { publicUrl: '' } })),
      })),
    },
  },
}));

import { uploadMedia } from '../../services/mediaUpload';

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
