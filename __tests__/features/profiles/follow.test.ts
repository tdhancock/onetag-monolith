//
// target: __tests__/features/profiles/follow.test.ts
//
// Following, as ONE-15 rebuilt it: the fourth instance of the like/save/repost
// shape, running on `lib/optimisticToggle.ts` rather than on a fourth
// hand-written rollback.
//
// The requirement that makes this worth a suite of its own is that the button
// and the target's *follower count* are two different cache entries, and both
// have to move together and go back together. A count left one too high after
// a failed follow is the kind of wrong number nobody thinks to distrust.

jest.mock('../../../services/supabase.native', () => ({
  supabase: { from: jest.fn(), auth: { getUser: jest.fn() } },
}));

import { QueryClient, MutationObserver } from '@tanstack/react-query';
import { toggleMutationOptions } from '../../../lib/optimisticToggle';
import { profileKeys } from '../../../features/profiles/keys';

// ─── Fixtures ───────────────────────────────────────────────────────────

const VIEWER = 'viewer-1';
const TARGET = { userId: 'target-1', username: 'Layla' };

const listKey = profileKeys.followingUsernames(VIEWER);
const targetCountsKey = profileKeys.counts(TARGET.userId);
const viewerCountsKey = profileKeys.counts(VIEWER);

interface FollowCounts {
  followers: number;
  following: number;
}

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const seed = (client: QueryClient, following: string[]) => {
  client.setQueryData(listKey, following);
  client.setQueryData<FollowCounts>(targetCountsKey, { followers: 10, following: 4 });
  client.setQueryData<FollowCounts>(viewerCountsKey, { followers: 2, following: following.length });
};

/**
 * The configuration `useToggleFollow` builds, without the hook around it: the
 * cached list of followed usernames is the entity, and the counts are moved
 * alongside it.
 */
const followConfig = (client: QueryClient, serverCall: () => Promise<unknown>) => {
  const moveCounts = (delta: number) => {
    client.setQueryData<FollowCounts>(targetCountsKey, (counts) =>
      counts ? { ...counts, followers: Math.max(0, counts.followers + delta) } : counts,
    );
    client.setQueryData<FollowCounts>(viewerCountsKey, (counts) =>
      counts ? { ...counts, following: Math.max(0, counts.following + delta) } : counts,
    );
  };

  return {
    entityKey: () => listKey,
    listKey: profileKeys.all,
    entityId: () => '',
    isOn: (names: string[], username: string) => names.includes(username.toLowerCase()),
    count: (names: string[]) => names.length,
    apply: (names: string[], next: { isOn: boolean }, username: string) => {
      moveCounts(next.isOn ? 1 : -1);
      return next.isOn
        ? [...names, username.toLowerCase()]
        : names.filter((n) => n !== username.toLowerCase());
    },
    mutationFn: async (username: string) => {
      const shouldFollow = (client.getQueryData<string[]>(listKey) ?? []).includes(
        username.toLowerCase(),
      );
      try {
        return await serverCall();
      } catch (error) {
        moveCounts(shouldFollow ? -1 : 1);
        throw error;
      }
    },
  };
};

const runToggle = async (
  client: QueryClient,
  serverCall: () => Promise<unknown>,
  username = TARGET.username,
): Promise<void> => {
  const observer = new MutationObserver<unknown, Error, string>(
    client,
    toggleMutationOptions(client, followConfig(client, serverCall)) as never,
  );
  await observer.mutate(username).catch(() => undefined);
};

const counts = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryData<FollowCounts>(key as never)!;

// ─── Tests ──────────────────────────────────────────────────────────────

describe('following someone', () => {
  it('adds them to the followed list', async () => {
    const client = newClient();
    seed(client, []);

    await runToggle(client, async () => undefined);

    expect(client.getQueryData<string[]>(listKey)).toEqual(['layla']);
  });

  it('moves the follower count with the button, not after it', async () => {
    const client = newClient();
    seed(client, []);

    let resolve!: () => void;
    const pending = new Promise<void>((r) => { resolve = r; });
    const running = runToggle(client, () => pending);
    await new Promise<void>((r) => setTimeout(r, 0));

    // Still in flight, and both have already moved.
    expect(client.getQueryData<string[]>(listKey)).toEqual(['layla']);
    expect(counts(client, targetCountsKey).followers).toBe(11);
    expect(counts(client, viewerCountsKey).following).toBe(1);

    resolve();
    await running;
  });

  it('matches the username case-insensitively', async () => {
    // Screens carry whatever case the profile row has; the list is lowercased.
    const client = newClient();
    seed(client, ['layla']);

    await runToggle(client, async () => undefined, 'LAYLA');

    expect(client.getQueryData<string[]>(listKey)).toEqual([]);
  });
});

describe('unfollowing', () => {
  it('removes them and takes the follower count down', async () => {
    const client = newClient();
    seed(client, ['layla']);

    await runToggle(client, async () => undefined);

    expect(client.getQueryData<string[]>(listKey)).toEqual([]);
    expect(counts(client, targetCountsKey).followers).toBe(9);
  });
});

describe('when the server refuses', () => {
  const refuse = async () => { throw new Error('refused'); };

  it('reverts the button and the follower count together', async () => {
    const client = newClient();
    seed(client, []);

    await runToggle(client, refuse);

    expect(client.getQueryData<string[]>(listKey)).toEqual([]);
    expect(counts(client, targetCountsKey).followers).toBe(10);
    expect(counts(client, viewerCountsKey).following).toBe(0);
  });

  it('reverts a failed unfollow the same way', async () => {
    const client = newClient();
    seed(client, ['layla']);

    await runToggle(client, refuse);

    expect(client.getQueryData<string[]>(listKey)).toEqual(['layla']);
    expect(counts(client, targetCountsKey).followers).toBe(10);
  });

  it('leaves other profiles\' counts alone', async () => {
    const client = newClient();
    seed(client, []);
    const otherKey = profileKeys.counts('someone-else');
    client.setQueryData<FollowCounts>(otherKey, { followers: 77, following: 3 });

    await runToggle(client, refuse);

    expect(counts(client, otherKey).followers).toBe(77);
  });
});

describe('follow and unfollow in sequence', () => {
  it('settles back where it started', async () => {
    const client = newClient();
    seed(client, []);

    await runToggle(client, async () => undefined);
    await runToggle(client, async () => undefined);

    expect(client.getQueryData<string[]>(listKey)).toEqual([]);
    expect(counts(client, targetCountsKey).followers).toBe(10);
  });
});

describe('query keys', () => {
  it('keeps follow state under a different key from the follower list', () => {
    // Two shapes under one key would be one cache entry, and whichever
    // resolved last would win.
    expect(profileKeys.followingUsernames(VIEWER)).not.toEqual(profileKeys.following(VIEWER));
  });

  it('nests every profile key under the domain, so one invalidation reaches all', () => {
    for (const key of [
      profileKeys.mine(VIEWER),
      profileKeys.byUsername('layla'),
      profileKeys.posts(VIEWER),
      profileKeys.counts(VIEWER),
      profileKeys.followingUsernames(VIEWER),
    ]) {
      expect(key[0]).toBe(profileKeys.all[0]);
    }
  });
});
