// The only place project query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('projects');

export const projectKeys = {
  ...base,
  /** The projects one profile owns. */
  owned: (ownerProfileId: string) => base.list({ ownerProfileId }),
  /** The projects one profile contributed to. */
  contributed: (contributorProfileId: string) => base.list({ contributorProfileId }),
  /** The projects inside one (ONE-134). A list, so creating or moving one reaches it. */
  children: (parentProjectId: string) => base.list({ parentProjectId }),
  /** The projects that Link one product. A list, so a project's change reaches it. */
  usingProduct: (productId: string) => base.list({ productId }),
  /** One project's contributors. */
  contributors: (projectId: string) => [...base.all, 'contributors', projectId] as const,
  /** The products one project Links. */
  products: (projectId: string) => [...base.all, 'products', projectId] as const,
};
