// The only place project query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('projects');

export const projectKeys = {
  ...base,
  /** The projects one profile owns. */
  owned: (ownerProfileId: string) => base.list({ ownerProfileId }),
  /** The projects one profile contributed to. */
  contributed: (contributorProfileId: string) => base.list({ contributorProfileId }),
  /** The projects that Link one product. A list, so a project's change reaches it. */
  usingProduct: (productId: string) => base.list({ productId }),
  /** A picker's search across every account's public projects. */
  search: (query: string) => base.list({ search: query }),
  /** One project's contributors. */
  contributors: (projectId: string) => [...base.all, 'contributors', projectId] as const,
  /** The products one project Links. */
  products: (projectId: string) => [...base.all, 'products', projectId] as const,
};
