// The only place product query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('products');

export const productKeys = {
  ...base,
  /** Every product one business lists. */
  business: (businessProfileId: string) => base.list({ businessProfileId }),
  /** A picker's search across every business's products. */
  search: (query: string) => base.list({ search: query }),
};
