// Pure Supabase access for interests (ONE-49).
//
// No React, no hooks, no imports from another feature. The list is a
// reference table, seeded and changed only by migrations; the API reads it.

import { supabase } from '../../services/supabase.native';
import type { Interest } from './types';

export const fetchInterests = async (): Promise<Interest[]> => {
  const { data, error } = await supabase.from('interests').select('slug, name').order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Interest[];
};
