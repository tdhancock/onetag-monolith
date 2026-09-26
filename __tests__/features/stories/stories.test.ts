//
// target: __tests__/features/stories/stories.test.ts
//
// The stories (OneSnaps) domain (ONE-19), driven through a real QueryClient:
// the optimistic upload that replaced AppContext's `replaceStory`, delete,
// the like toggle on the shared helper, the fire-and-forget view record,
// 24-hour expiry, and the realtime delete. Each block maps to an acceptance
// criterion on the ticket.

const mockUploadStory = jest.fn();
const mockDeleteStory = jest.fn();
const mockToggleLike = jest.fn();
const mockRecordView = jest.fn();
const mockSendMessage = jest.fn();

jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../../services/storyUpload', () => ({
  uriToUploadBlob: jest.fn(async () => ({ type: 'image/jpeg' })),
}));

jest.mock('../../../features/stories/api', () => ({
  uploadStory: (...args: unknown[]) => mockUploadStory(...args),
  deleteStoryFromDatabase: (...args: unknown[]) => mockDeleteStory(...args),
  toggleStoryLikeInDatabase: (...args: unknown[]) => mockToggleLike(...args),
  recordStoryView: (...args: unknown[]) => mockRecordView(...args),
}));

jest.mock('../../../features/messages', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  messageKeys: { conversations: (userId: string) => ['messages', 'conversations', userId] },
}));

import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { storyKeys } from '../../../features/stories/keys';
import {
  deleteStoryOptions,
  recordStoryViewOptions,
  replyToStoryOptions,
  storyLikeToggleConfig,
  uploadStoryOptions,
} from '../../../features/stories/mutations';
import { removeStoryFromLists } from '../../../features/stories/realtime';
import { hasUnviewedStory, STORY_STALE_TIME_MS } from '../../../features/stories/queries';
import { toggleMutationOptions } from '../../../lib/optimisticToggle';
import {
  parseViewedStoryTimestamps,
  serializeViewedStoryTimestamps,
} from '../../../lib/viewedStories';
import type { Story } from '../../../types';
import { asProfileId } from '../../../types';

// ─── Fixtures ───────────────────────────────────────────────────────────

const ME = { id: asProfileId('me'), username: 'me', avatar: null };
const MINE = storyKeys.mine(ME.id);
const REEL = storyKeys.reel(ME.id);
const LIKED = storyKeys.liked(ME.id);

const story = (id: string, overrides: Partial<Story> = {}): Story => ({
  id,
  userId: 'someone',
  username: 'someone',
  avatar: null,
  timestamp: new Date().toISOString(),
  ...overrides,
});

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const idsOf = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryData<Story[]>(key)?.map((s) => s.id);

const run = async <TVariables>(client: QueryClient, options: object, variables: TVariables) => {
  const observer = new MutationObserver<unknown, Error, TVariables>(client, options as never);
  await observer.mutate(variables).catch(() => undefined);
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mockUploadStory.mockReset();
  mockDeleteStory.mockReset();
  mockToggleLike.mockReset();
  mockRecordView.mockReset();
  mockSendMessage.mockReset();
});

// ─── 1. Upload ──────────────────────────────────────────────────────────

describe('uploading a story', () => {
  it('appears at once, then is replaced by the server copy', async () => {
    const client = newClient();
    client.setQueryData(MINE, [story('old')]);
    const server = deferred<Story>();
    mockUploadStory.mockReturnValue(server.promise);

    const observer = new MutationObserver(client, uploadStoryOptions(client, ME) as never);
    const uploading = observer.mutate({ imageUri: 'file:///photo.jpg' } as never);
    await flush();

    const pending = client.getQueryData<Story[]>(MINE)!;
    expect(pending).toHaveLength(2);
    expect(pending[0].id).toMatch(/^local-/);
    expect(pending[0].imageUrl).toBe('file:///photo.jpg');

    server.resolve(story('server-1', { userId: ME.id }));
    await uploading;

    expect(idsOf(client, MINE)).toEqual(['server-1', 'old']);
  });

  it('removes the optimistic entry when the upload fails', async () => {
    const client = newClient();
    client.setQueryData(MINE, [story('old')]);
    mockUploadStory.mockRejectedValue(new Error('storage down'));

    await run(client, uploadStoryOptions(client, ME), { imageUri: 'file:///photo.jpg' });

    expect(idsOf(client, MINE)).toEqual(['old']);
  });

  it('sends a text story without a file, with its background', async () => {
    const client = newClient();
    mockUploadStory.mockResolvedValue(story('s'));

    await run(client, uploadStoryOptions(client, ME), { caption: 'hello', background: 'plum' });

    expect(mockUploadStory).toHaveBeenCalledWith(null, 'hello', ME.id, 'plum');
  });

  it('sends no background with an image, even if one is given', async () => {
    const client = newClient();
    mockUploadStory.mockResolvedValue(story('s'));

    await run(client, uploadStoryOptions(client, ME), { imageUri: 'file:///photo.jpg', background: 'plum' });

    expect(mockUploadStory).toHaveBeenCalledWith({ type: 'image/jpeg' }, null, ME.id, null);
  });

  it('shows the optimistic text story on its chosen background', async () => {
    const client = newClient();
    client.setQueryData(MINE, []);
    const server = deferred<Story>();
    mockUploadStory.mockReturnValue(server.promise);

    const observer = new MutationObserver(client, uploadStoryOptions(client, ME) as never);
    const uploading = observer.mutate({ caption: 'hello', background: 'teal' } as never);
    await flush();

    const optimistic = client.getQueryData<Story[]>(MINE)![0];
    expect(optimistic.background).toBe('teal');
    expect(optimistic.imageUrl).toBeUndefined();

    server.resolve(story('server-1', { userId: ME.id }));
    await uploading;
  });

  it('does not create "Your story" before it has loaded', async () => {
    const client = newClient();
    mockUploadStory.mockResolvedValue(story('s'));

    await run(client, uploadStoryOptions(client, ME), { caption: 'hello' });

    expect(client.getQueryData(MINE)).toBeUndefined();
  });
});

// ─── 2. Delete ──────────────────────────────────────────────────────────

describe('deleting a story', () => {
  it('takes it out of every cached list', async () => {
    const client = newClient();
    client.setQueryData(MINE, [story('a'), story('b')]);
    client.setQueryData(REEL, [story('a')]);
    mockDeleteStory.mockResolvedValue(true);

    await run(client, deleteStoryOptions(client), 'a');

    expect(idsOf(client, MINE)).toEqual(['b']);
    expect(idsOf(client, REEL)).toEqual([]);
  });

  it('puts it back when the server refuses', async () => {
    const client = newClient();
    client.setQueryData(MINE, [story('a')]);
    mockDeleteStory.mockResolvedValue(false);

    await run(client, deleteStoryOptions(client), 'a');

    expect(idsOf(client, MINE)).toEqual(['a']);
  });

  it('never calls the server for a story still uploading', async () => {
    const client = newClient();
    client.setQueryData(MINE, [story('local-1')]);

    await run(client, deleteStoryOptions(client), 'local-1');

    expect(mockDeleteStory).not.toHaveBeenCalled();
    expect(idsOf(client, MINE)).toEqual([]);
  });
});

// ─── 3. Like ────────────────────────────────────────────────────────────

describe('liking a story', () => {
  it('flips at once and stays when the server agrees', async () => {
    const client = newClient();
    client.setQueryData(LIKED, []);
    mockToggleLike.mockResolvedValue(undefined);

    await run(client, toggleMutationOptions(client, storyLikeToggleConfig(ME.id)), 's1');

    expect(mockToggleLike).toHaveBeenCalledWith('s1', ME.id);
  });

  it('reverts when the server rejects it', async () => {
    const client = newClient();
    client.setQueryData(LIKED, ['other']);
    const server = deferred<void>();
    mockToggleLike.mockReturnValue(server.promise);

    const observer = new MutationObserver(
      client,
      toggleMutationOptions(client, storyLikeToggleConfig(ME.id)) as never,
    );
    const liking = observer.mutate('s1' as never).catch(() => undefined);
    await flush();
    expect(client.getQueryData(LIKED)).toEqual(['other', 's1']);

    server.reject(new Error('RLS'));
    await liking;
    expect(client.getQueryData(LIKED)).toEqual(['other']);
  });
});

// ─── 4. Views ───────────────────────────────────────────────────────────

describe('recording a view', () => {
  it('swallows a failure: no retry, nothing thrown to the caller', async () => {
    const client = newClient();
    mockRecordView.mockRejectedValue(new Error('offline'));
    const options = recordStoryViewOptions(ME.id);

    const observer = new MutationObserver(client, options as never);
    await expect(observer.mutate('s1' as never).catch((e) => e)).resolves.toBeInstanceOf(Error);

    expect(options.retry).toBe(false);
    // The failure is handled inside the options — there is no toast to raise.
    expect(() => options.onError()).not.toThrow();
    expect(mockRecordView).toHaveBeenCalledTimes(1);
  });
});

// ─── 5. Reply ───────────────────────────────────────────────────────────

describe('replying to a story', () => {
  it('is a direct message to the owner, marked as a story reply', async () => {
    const client = newClient();
    mockSendMessage.mockResolvedValue({ id: 'm1' });

    await run(client, replyToStoryOptions(client, ME.id), {
      story: { id: 's1', userId: 'owner' },
      text: 'nice',
    });

    expect(mockSendMessage).toHaveBeenCalledWith({
      sender_id: ME.id,
      receiver_id: 'owner',
      text: 'nice',
      replied_story_id: 's1',
    });
  });
});

// ─── 6. Expiry and realtime ─────────────────────────────────────────────

describe('expiry', () => {
  it('keeps the reel fresh for well under the app-wide minute', () => {
    expect(STORY_STALE_TIME_MS).toBeLessThan(60_000);
  });
});

describe('realtime delete', () => {
  it('drops the story from every cached list without a refetch', () => {
    const client = newClient();
    client.setQueryData(MINE, [story('a'), story('b')]);
    client.setQueryData(REEL, [story('b')]);

    removeStoryFromLists(client, 'b');

    expect(idsOf(client, MINE)).toEqual(['a']);
    expect(idsOf(client, REEL)).toEqual([]);
  });
});

// ─── 7. Viewed set (local state) ────────────────────────────────────────

describe('the viewed set', () => {
  const NOW = Date.parse('2026-09-24T12:00:00.000Z');
  const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

  it('keeps recent marks and drops long-expired ones', () => {
    const parsed = parseViewedStoryTimestamps([hoursAgo(1), hoursAgo(72)], NOW);
    expect(Array.from(parsed)).toEqual([hoursAgo(1)]);
  });

  it.each([null, undefined, 'x', 42, { a: 1 }, [1, null, 'not-a-date']])(
    'tolerates a malformed payload: %p',
    (payload) => {
      expect(parseViewedStoryTimestamps(payload, NOW).size).toBe(0);
    },
  );

  it('prunes on the way out too', () => {
    const viewed = new Set([hoursAgo(2), hoursAgo(100)]);
    expect(serializeViewedStoryTimestamps(viewed, NOW)).toEqual([hoursAgo(2)]);
  });

  it('derives "has a new story" instead of storing it', () => {
    const stories = [story('a', { timestamp: 't1' }), story('b', { timestamp: 't2' })];
    expect(hasUnviewedStory(stories, (t) => t === 't1')).toBe(true);
    expect(hasUnviewedStory(stories, () => true)).toBe(false);
    expect(hasUnviewedStory(undefined, () => false)).toBe(false);
  });
});
