//
// target: __tests__/services/apiService.profile.test.ts
//
// The profile save path. Both defects this suite covers were invisible to the
// existing suites because they only asserted that Supabase was *called* — so
// every assertion here is on the payload that reaches `.update()` or
// `.upload()`, never just the call count.
//
//   1. `updateUserProfileData` must map client field names onto column names:
//      `name → full_name`, `profilePicture → avatar_url`. `profiles` has no
//      `name` column, and PostgREST rejects the whole statement if one is named.
//   2. The avatar must be uploaded via the React Native arrayBuffer path and
//      its returned public URL — not the local file:// URI — written to
//      `avatar_url`.

const mockUpdate = jest.fn();
const mockEq = jest.fn();
const mockUpload = jest.fn();
const mockGetPublicUrl = jest.fn();
const mockGetUser = jest.fn();

jest.mock('../../services/supabase.native', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: jest.fn(() => ({ update: (...args: unknown[]) => mockUpdate(...args) })),
    storage: {
      from: jest.fn(() => ({
        upload: (...args: unknown[]) => mockUpload(...args),
        getPublicUrl: (...args: unknown[]) => mockGetPublicUrl(...args),
      })),
    },
  },
}), { virtual: true });

import { updateUserProfileData, uploadAvatar, mapProfileUpdatesToRow } from '../../services/apiService';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const PUBLIC_URL = `https://example.supabase.co/storage/v1/object/public/avatars/${USER_ID}/1.jpg`;

/** The payload handed to `.update()` on the most recent call. */
const lastUpdatePayload = () => mockUpdate.mock.calls.at(-1)?.[0] as Record<string, unknown>;

describe('profile save path', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mockEq.mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: (...args: unknown[]) => mockEq(...args) });
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: PUBLIC_URL } });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as unknown as Response) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // --- 1. Column mapping --------------------------------------------------

  it('updates full_name and never sends the client-side name field', async () => {
    const ok = await updateUserProfileData({ name: 'Ada Lovelace' });

    expect(ok).toBe(true);
    const payload = lastUpdatePayload();
    expect(payload).toEqual({ full_name: 'Ada Lovelace' });
    expect(payload).not.toHaveProperty('name');
    expect(mockEq).toHaveBeenCalledWith('id', USER_ID);
  });

  it('maps profilePicture onto avatar_url', () => {
    expect(mapProfileUpdatesToRow({ profilePicture: PUBLIC_URL })).toEqual({
      avatar_url: PUBLIC_URL,
    });
  });

  it('passes username and bio through unmapped, because those columns match', () => {
    expect(mapProfileUpdatesToRow({ username: 'ada', bio: 'Hello' })).toEqual({
      username: 'ada',
      bio: 'Hello',
    });
  });

  it('omits fields that were not supplied rather than nulling them', () => {
    expect(mapProfileUpdatesToRow({ bio: 'Only the bio' })).toEqual({ bio: 'Only the bio' });
  });

  it('reports failure when the update errors', async () => {
    mockEq.mockResolvedValue({ error: { message: 'column "name" does not exist' } });

    await expect(updateUserProfileData({ name: 'Ada' })).resolves.toBe(false);
  });

  // --- 2. Avatar upload ---------------------------------------------------

  it('uploads the avatar as an ArrayBuffer, not a Blob', async () => {
    const url = await uploadAvatar('file:///tmp/avatar.jpg');

    expect(url).toBe(PUBLIC_URL);
    const [path, body, options] = mockUpload.mock.calls[0] as [string, unknown, Record<string, unknown>];
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect(options.contentType).toBe('image/jpeg');
    // Storage RLS matches the second path segment against auth.uid().
    expect(path.split('/')[1]).toBe(USER_ID);
  });

  it('writes the returned https URL to avatar_url, not the local file:// URI', async () => {
    const localUri = 'file:///tmp/avatar.jpg';
    const uploaded = await uploadAvatar(localUri);
    await updateUserProfileData({ profilePicture: uploaded ?? undefined });

    const payload = lastUpdatePayload();
    expect(payload.avatar_url).toBe(PUBLIC_URL);
    expect(payload.avatar_url).not.toBe(localUri);
    expect(String(payload.avatar_url)).toMatch(/^https:\/\//);
  });

  it('returns null when the upload fails, so no file:// URI can be persisted', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'storage is unavailable' } });

    const url = await uploadAvatar('file:///tmp/avatar.jpg');

    expect(url).toBeNull();
    // A failed upload must not reach the database at all.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns null when the local file cannot be read', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as unknown as Response) as unknown as typeof fetch;

    await expect(uploadAvatar('file:///tmp/missing.jpg')).resolves.toBeNull();
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
