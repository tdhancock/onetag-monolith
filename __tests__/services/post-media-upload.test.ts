//
// target: __tests__/services/post-media-upload.test.ts
//
// The post media upload path. The defect: when the upload threw, the caller
// swallowed it and published anyway with a `file://` URI, so the post rendered
// for its author and for nobody else — permanently, with no retry and no
// record. Every assertion here is about what does *not* reach `.insert()`.
//
//   1. A failing upload rejects, and no row is inserted.
//   2. A successful upload inserts the remote https URL.
//   3. The image is uploaded exactly once (it used to go up twice — once in
//      AppContext.addProfilePost and again in publishPost).
//   4. `assertRemoteMediaUrl` throws for every device-local URI scheme, so a
//      future regression fails loudly instead of writing a broken row.

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockUpload = jest.fn();
const mockGetPublicUrl = jest.fn();

jest.mock('../../services/supabase.native', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
    storage: {
      from: jest.fn(() => ({
        upload: (...args: unknown[]) => mockUpload(...args),
        getPublicUrl: (...args: unknown[]) => mockGetPublicUrl(...args),
      })),
    },
  },
}));

import { publishPost } from '../../features/posts';
import { assertRemoteMediaUrl, MediaUploadError } from '../../services/mediaUpload';
import type { Post } from '../../types';
import { asProfileId } from '../../types';

const USER_ID = '22222222-2222-2222-2222-222222222222';
// A profile id that is not the auth id — every account after ONE-21.
const AUTHOR = asProfileId('33333333-3333-3333-3333-333333333333');
const LOCAL_URI = 'file:///var/mobile/Containers/photo.jpg';
const PUBLIC_URL = `https://example.supabase.co/storage/v1/object/public/post-media/${USER_ID}/posts/1.jpg`;

const mockInsert = jest.fn();

/** The row handed to `.insert()` on the most recent call. */
const lastInsertedRow = () =>
  (mockInsert.mock.calls.at(-1)?.[0] as Record<string, unknown>[])?.[0];

const draft = (): Post => ({
  id: 'temp-1',
  content: 'a caption worth keeping',
  username: 'tanner',
  name: 'Tanner',
  avatar: null,
  timestamp: '2026-09-22T00:00:00.000Z',
  media: LOCAL_URI,
  media_type: 'image',
  likes: 0,
  reposts: 0,
  replies: 0,
} as Post);

describe('post media upload path', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID, user_metadata: {}, email: 'a@b.c' } } });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: PUBLIC_URL } });
    mockUpload.mockResolvedValue({ error: null });

    // `profiles` → the row already exists; `posts` → capture the insert and
    // return enough for publishPost to read the row back.
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: AUTHOR }], error: null }) }) }),
        };
      }
      return {
        insert: (...args: unknown[]) => {
          mockInsert(...args);
          return { select: () => ({ single: async () => ({ data: { id: 'post-1' }, error: null }) }) };
        },
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { id: 'post-1', image_url: PUBLIC_URL, content: '' }, error: null }),
          }),
        }),
      };
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as unknown as Response) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects rather than publishing when the media upload fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as unknown as typeof fetch;

    await expect(publishPost(draft(), AUTHOR)).rejects.toBeInstanceOf(MediaUploadError);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('never inserts a device-local URI as image_url', async () => {
    // Every bucket rejects with a policy error, so uploadMedia falls back to a
    // data: URL — readable only on this device, so the insert must not happen.
    mockUpload.mockResolvedValue({ error: { message: 'new row violates row-level security policy' } });

    await expect(publishPost(draft(), AUTHOR)).rejects.toBeInstanceOf(MediaUploadError);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('inserts the remote https URL when the upload succeeds', async () => {
    await publishPost(draft(), AUTHOR);

    expect(lastInsertedRow().image_url).toBe(PUBLIC_URL);
    expect(String(lastInsertedRow().image_url).startsWith('https://')).toBe(true);
  });

  it('attributes the post to the profile and uploads under the account (ONE-22)', async () => {
    await publishPost(draft(), AUTHOR);

    // The row belongs to the profile being acted as...
    expect(lastInsertedRow().user_id).toBe(AUTHOR);
    // ...while storage RLS keys the path on auth.uid(), never a profile id.
    const [path] = mockUpload.mock.calls[0] as [string];
    expect(path).toContain(USER_ID);
    expect(path).not.toContain(AUTHOR);
  });

  it('uploads the image exactly once', async () => {
    await publishPost(draft(), AUTHOR);

    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('leaves an already-remote URL alone', async () => {
    await publishPost({ ...draft(), media: PUBLIC_URL }, AUTHOR);

    expect(mockUpload).not.toHaveBeenCalled();
    expect(lastInsertedRow().image_url).toBe(PUBLIC_URL);
  });

  it.each(['file:///tmp/a.jpg', 'content://media/1', 'blob:abc', 'data:image/png;base64,AAA'])(
    'assertRemoteMediaUrl throws for %s',
    (uri) => {
      expect(() => assertRemoteMediaUrl(uri)).toThrow(MediaUploadError);
    },
  );

  it('assertRemoteMediaUrl accepts a remote URL or no media at all', () => {
    expect(() => assertRemoteMediaUrl(PUBLIC_URL)).not.toThrow();
    expect(() => assertRemoteMediaUrl(null)).not.toThrow();
  });
});
