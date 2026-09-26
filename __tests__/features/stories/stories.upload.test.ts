//
// target: __tests__/features/stories/stories.upload.test.ts
//
// Text OneSnaps are stored as what they are (ONE-78): a row with no media,
// the words in `caption` and the chosen gradient in `background`. They used to
// fail on media_url's NOT NULL and be retried as an SVG picture of the text;
// rows stored that way are read back as text OneSnaps.

const mockInserts: Record<string, unknown>[] = [];
let mockInsertResult: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('../../../services/supabase.native', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'auth-me' } }, error: null }) },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        mockInserts.push(row);
        const chain = {
          select: () => chain,
          single: async () => mockInsertResult,
        };
        return chain;
      },
    }),
    storage: {
      from: () => ({ getPublicUrl: () => ({ data: { publicUrl: 'https://cdn.test/snap.jpg' } }) }),
    },
  },
}));

jest.mock('../../../services/profileBootstrap', () => ({ ensureProfileRowForUser: async () => true }));
jest.mock('../../../services/mediaUpload', () => ({
  isLikelyStoragePolicyError: () => false,
  isStorageBucketMissingError: () => false,
}));
jest.mock('../../../services/storyUpload', () => ({
  uploadStoryMedia: async () => ({ bucket: 'post-media', filePath: 'auth-me/stories/a.jpg' }),
  blobToDataUrl: jest.fn(),
  buildTextStoryDataUri: jest.fn(() => 'data:image/svg+xml;utf8,should-not-be-used'),
}));

import { mapStoryRow, uploadStory } from '../../../features/stories/api';
import { asProfileId } from '../../../types';

const ME = asProfileId('p-me');

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  user_id: 'p-me',
  created_at: '2026-09-25T10:00:00.000Z',
  media_url: null,
  caption: 'hello',
  background: 'plum',
  profiles: { username: 'me', avatar_url: null },
  ...overrides,
});

beforeEach(() => {
  mockInserts.length = 0;
  mockInsertResult = { data: row(), error: null };
});

// ─── Writing ────────────────────────────────────────────────────────────

describe('uploadStory — a text OneSnap', () => {
  it('inserts no media, its words and its background, in one insert', async () => {
    await uploadStory(null, 'hello', ME, 'plum');
    expect(mockInserts).toEqual([
      { user_id: ME, media_url: null, caption: 'hello', background: 'plum' },
    ]);
  });

  it('comes back as a text OneSnap on that background', async () => {
    const story = await uploadStory(null, 'hello', ME, 'plum');
    expect(story.imageUrl).toBeUndefined();
    expect(story.content).toBe('hello');
    expect(story.background).toBe('plum');
  });

  it('no longer retries as an SVG picture when the insert fails', async () => {
    mockInsertResult = { data: null, error: { code: '23502', message: 'null value' } };
    await expect(uploadStory(null, 'hello', ME, 'plum')).rejects.toMatchObject({ code: '23502' });
    expect(mockInserts).toHaveLength(1);
  });
});

describe('uploadStory — an image OneSnap', () => {
  it('stores the media and no background', async () => {
    mockInsertResult = { data: row({ media_url: 'https://cdn.test/snap.jpg', background: null }), error: null };
    await uploadStory(new Blob(['x'], { type: 'image/jpeg' }), null, ME, 'plum');
    expect(mockInserts).toEqual([
      { user_id: ME, media_url: 'https://cdn.test/snap.jpg', caption: null, background: null },
    ]);
  });
});

// ─── Reading ────────────────────────────────────────────────────────────

describe('mapStoryRow', () => {
  it('reads a text OneSnap and its background', () => {
    expect(mapStoryRow(row())).toMatchObject({
      id: 's1',
      imageUrl: undefined,
      content: 'hello',
      background: 'plum',
    });
  });

  it('reads an image OneSnap with no background', () => {
    const story = mapStoryRow(row({ media_url: 'https://cdn.test/snap.jpg', caption: null, background: null }));
    expect(story.imageUrl).toBe('https://cdn.test/snap.jpg');
    expect(story.background).toBeNull();
  });

  it('reads an SVG stand-in from before ONE-78 as a text OneSnap', () => {
    const legacy = row({
      media_url: 'data:image/svg+xml;utf8,%3Csvg%3E%3C%2Fsvg%3E',
      caption: 'old words',
      background: undefined,
    });
    const story = mapStoryRow(legacy);
    expect(story.imageUrl).toBeUndefined();
    expect(story.content).toBe('old words');
    expect(story.background).toBeNull();
  });

  it('leaves an inline photo alone', () => {
    const story = mapStoryRow(row({ media_url: 'data:image/jpeg;base64,AAAA' }));
    expect(story.imageUrl).toBe('data:image/jpeg;base64,AAAA');
  });
});
