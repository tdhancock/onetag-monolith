// A stand-in for a feature's query hook, for suites that mock the feature's
// barrel: it runs the mocked read once per key, as a query does, and returns
// the fields screens read from a query.
//
//   jest.mock('../../features/posts', () => ({
//     usePostQuery: (id: string) =>
//       require('../support/mockQuery').useMockQuery(`post:${id}`, () => mockFetchPost(id), Boolean(id)),
//   }));

import { useCallback, useEffect, useState } from 'react';

type Status = 'pending' | 'success' | 'error';

export interface MockQueryResult<T> {
  data: T | undefined;
  error: unknown;
  status: Status;
  isPending: boolean;
  /** Pending and fetching: false for a query that is disabled. */
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  isPlaceholderData: false;
  refetch: () => Promise<unknown>;
}

export function useMockQuery<T>(key: string, read: () => T | Promise<T>, enabled = true): MockQueryResult<T> {
  const [result, setResult] = useState<{ status: Status; data?: T; error?: unknown; key?: string }>({ status: 'pending' });
  const [attempt, setAttempt] = useState(0);
  const [latestRead] = useState(() => ({ current: read }));
  latestRead.current = read;

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    Promise.resolve()
      .then(() => latestRead.current())
      .then(
        (data) => { if (live) setResult({ status: 'success', data, key }); },
        (error) => { if (live) setResult({ status: 'error', error, key }); },
      );
    return () => { live = false; };
  }, [key, enabled, attempt, latestRead]);

  const refetch = useCallback(() => {
    setAttempt((n) => n + 1);
    return Promise.resolve();
  }, []);

  // A new key starts pending, as a query with no cached entry does.
  const current = result.key === key ? result : { status: 'pending' as Status };
  return {
    data: current.data,
    error: current.error ?? null,
    status: current.status,
    isPending: current.status === 'pending',
    isLoading: enabled && current.status === 'pending',
    isSuccess: current.status === 'success',
    isError: current.status === 'error',
    isPlaceholderData: false,
    refetch,
  };
}
