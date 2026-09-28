// Stands in for services/supabase.native in the API checks (ONE-114):
// jest.api.config.js maps every import of that module here, so the app's own
// data layer talks to the local stack, as whichever account `actAs` names.

import type { SupabaseClient } from '@supabase/supabase-js';
import { anonClient } from './localStack';

let current: SupabaseClient = anonClient();

/** Make the app's calls from here on as this client's account. */
export const actAs = (client: SupabaseClient): void => {
  current = client;
};

export const supabase = new Proxy({} as SupabaseClient, {
  get: (_target, property) => {
    const value = (current as unknown as Record<PropertyKey, unknown>)[property];
    return typeof value === 'function' ? value.bind(current) : value;
  },
});
