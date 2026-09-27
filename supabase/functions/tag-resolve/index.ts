// Supabase Edge Function: tag-resolve (ONE-36)
//
// The tag host's web surface: the page https://<tag host>/t/<code> shows
// someone without the app, and the two well-known files universal links need.
// All of it lives in handler.ts, which Jest runs. This file only wires it to
// Supabase and the edge runtime.
//
// Browsers call it, never the app, so it takes no JWT: `verify_jwt = false` in
// supabase/config.toml. It reads with the anon key and no session, so RLS
// decides what a stranger sees, exactly as it does for a signed-out visitor in
// the app. It holds no service-role key, because nothing here needs more than
// a stranger may do.
//
// How the tag host reaches this function is in docs/deep-links.md.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { PRODUCT_COLUMNS, PROFILE_COLUMNS, PROJECT_COLUMNS, handleRequest } from './handler.ts';
import type { ProductRow, ProfileRow, ProjectRow, ResolveTagRow, TagSource } from './handler.ts';

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void } | undefined;

const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const source: TagSource = {
  async resolveTag(shortCode) {
    const { data, error } = await supabase.rpc('resolve_tag', { p_short_code: shortCode }).maybeSingle();
    if (error) throw error;
    return data as ResolveTagRow | null;
  },

  async readProfile(profileId) {
    const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', profileId).maybeSingle();
    if (error) throw error;
    return data as ProfileRow | null;
  },

  async readProduct(productId) {
    const { data, error } = await supabase.from('products').select(PRODUCT_COLUMNS).eq('id', productId).maybeSingle();
    if (error) throw error;
    return data as unknown as ProductRow | null;
  },

  // A private project reads as no row: RLS hides it from strangers, and the
  // page says the same thing the app's project screen does.
  async readProject(projectId) {
    const { data, error } = await supabase.from('projects').select(PROJECT_COLUMNS).eq('id', projectId).maybeSingle();
    if (error) throw error;
    return data as unknown as ProjectRow | null;
  },

  // Anonymous, and without RETURNING: a stranger may record a scan of a live
  // tag but may not read one back. scanned_at is the database's to set.
  async recordScan(tagId) {
    const { error } = await supabase.from('scans').insert({ tag_id: tagId });
    if (error) throw error;
  },
};

/** Keeps the scan insert alive after the response has gone. */
const waitUntil = (work: Promise<unknown>): void => {
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) EdgeRuntime.waitUntil(work);
};

Deno.serve((request) =>
  handleRequest(request, {
    source,
    tagBaseUrl: Deno.env.get('TAG_BASE_URL'),
    waitUntil,
    log: (message, error) => console.error(message, error),
  }),
);
