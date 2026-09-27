// The only place search query keys are constructed.

import { createQueryKeys } from '../../lib/queryKeys';

const base = createQueryKeys('search');

export const searchKeys = {
  ...base,
  profiles: (term: string) => base.list({ type: 'profiles', term }),
  posts: (term: string) => base.list({ type: 'posts', term }),
  products: (term: string, category: string | null) => base.list({ type: 'products', term, category }),
  projects: (term: string, category: string | null) => base.list({ type: 'projects', term, category }),
};
