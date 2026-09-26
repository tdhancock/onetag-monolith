// The only place tag query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('tags');

export const tagKeys = {
  ...base,
  /** What a short code resolves to, as the resolution route reads it. */
  resolution: (shortCode: string) => [...base.all, 'resolution', shortCode] as const,
  /**
   * Every tag one profile owns, with scan counts (ONE-34). The dashboard,
   * a tag's detail and its export all read this one entry, so pausing a tag
   * from any of them updates the rest.
   */
  mine: (ownerProfileId: string) => base.list({ ownerProfileId }),
  /** How often one owner's tags pointing at one destination were scanned (ONE-41). */
  destinationScans: (ownerProfileId: string, kind: string, destinationId: string) =>
    [...base.all, 'destination-scans', ownerProfileId, kind, destinationId] as const,
};
