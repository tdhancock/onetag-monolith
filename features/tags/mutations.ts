// Write hooks for the tags domain.

import { useMutation } from '@tanstack/react-query';
import { recordScan } from './api';
import type { ProfileId } from '../../types';

export interface RecordScanInput {
  tagId: string;
  /** The active profile, or null for a scan by someone signed out. */
  scannerProfileId: ProfileId | null;
}

/**
 * Record a Scan, fire-and-forget (ONE-30).
 *
 * Call `mutate`, never await it: a slow or failed insert must never delay or
 * prevent anyone reaching the Destination. Its errors are swallowed here —
 * there is no one to tell, and nothing they could do — and it is not retried,
 * so one resolution can never write two rows.
 */
export const useRecordScan = () =>
  useMutation<void, unknown, RecordScanInput>({
    mutationFn: ({ tagId, scannerProfileId }) => recordScan(tagId, scannerProfileId),
    retry: 0,
    onError: () => undefined,
  });
