// The only place product query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('products');

export const productKeys = {
  ...base,
  /** Every product one business lists. */
  business: (businessProfileId: string) => base.list({ businessProfileId }),
  /** The Projects that Link one product. */
  projects: (productId: string) => [...base.all, 'projects', productId] as const,
};
