// Account deletion: the request handler, kept free of Deno so Jest can run it.
// index.ts wires it to Supabase. Called from Settings.
//
// Two steps: the account's files, then the account.
//
// The files go first (ONE-99). Storage objects have no foreign key to the
// account, so no cascade reaches them. If any can't be removed, nothing else is
// deleted and the person can simply try again: removal can run twice, since a
// file already gone isn't listed. Deleting the account first would leave, on
// a failure, public files that nobody could ever retry.
//
// Then the auth user (ONE-88). Each profile belongs to its account through
// profiles.user_id ON DELETE CASCADE, and everything a profile owns references
// the profile the same way. So one delete removes the account's profiles,
// Individual and Business alike, and everything they own, in a single
// transaction that lands whole or not at all. It used to delete table by table
// first, by the auth user's id. Since ONE-21 those tables are keyed by profile
// id, so the loop matched nothing but the profiles row, and one failure
// half-way left an account half deleted.
//
// Three references outlive the account on purpose, set to null rather than
// deleted: a scan it made stays in the tag owner's counts, anonymous
// (scans.scanner_profile_id); a message between two other people that shared
// its profile keeps its text (messages.shared_profile_id); and a report an
// admin's profile reviewed keeps its history (reports.reviewed_by, ONE-98).
// supabase/tests/account_deletion.test.sql deletes a two-profile account
// against a real database, and __tests__/supabase/delete-user-account.test.ts
// checks that every migration's foreign key to a profile or an account says
// what happens on delete.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export interface AccountDeletion {
  /** The auth user the request's bearer token belongs to, or null when it isn't a signed-in user's. */
  callerId(authorization: string | null): Promise<string | null>;
  /** Remove every file the account uploaded. Resolves to an error message, or null. */
  removeMedia(authUserId: string): Promise<string | null>;
  /** Delete an auth user, and by cascade everything its account holds. Resolves to an error message, or null. */
  deleteUser(authUserId: string): Promise<string | null>;
  log?: (message: string, error: unknown) => void;
}

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Delete the caller's own account, and only ever the caller's. */
export const handleRequest = async (request: Request, deps: AccountDeletion): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authUserId = await deps.callerId(request.headers.get('Authorization'));
    if (!authUserId) return json(401, { error: 'Not authenticated' });

    const mediaFailure = await deps.removeMedia(authUserId);
    if (mediaFailure) return json(500, { error: 'Failed to delete media', details: mediaFailure });

    const failure = await deps.deleteUser(authUserId);
    if (failure) return json(500, { error: 'Failed to delete auth user', details: failure });

    return json(200, { success: true, message: 'Account permanently deleted' });
  } catch (error) {
    deps.log?.('delete-user-account failed', error);
    return json(500, { error: 'Internal server error', details: String(error) });
  }
};

// ─── The account's files (ONE-99) ───────────────────────────────────────
//
// Every uploader files under the auth user id: storage RLS requires it as the
// path's first folder, or its second after a folder of the uploader's choosing.
// So an account's files are the ones under `accountMediaPrefixes`, and removing
// them never needs to look at anyone else's.

/** The buckets the migrations create, and so the only ones that can hold a file. */
export const MEDIA_BUCKETS = ['avatars', 'post-media'];

/**
 * The folders that can sit in front of the account's id: the avatar's, and
 * the Destination folders (services/destinationMedia.ts's
 * DESTINATION_MEDIA_FOLDERS). Also `posts`, `stories` and `public`: until
 * ONE-100 the post and OneSnap uploaders fell back to them, in both buckets,
 * and files from then may still be there. Drop those three only once no stored
 * object can be under them. The test drives every uploader through every path
 * it tries, and fails if one isn't covered.
 */
export const FOLDERS_BEFORE_ACCOUNT = ['avatars', 'posts', 'stories', 'public', 'products', 'projects'];

/** Every folder that can hold one of the account's files, in every bucket. */
export const accountMediaPrefixes = (authUserId: string): { bucket: string; prefix: string }[] =>
  MEDIA_BUCKETS.flatMap((bucket) =>
    [authUserId, ...FOLDERS_BEFORE_ACCOUNT.map((folder) => `${folder}/${authUserId}`)].map((prefix) => ({
      bucket,
      prefix,
    })),
  );

/** One entry of a storage folder listing. */
export interface StorageEntry {
  name: string;
  isFolder: boolean;
}

/** The two storage operations removal needs. index.ts adapts supabase-js to them. */
export interface MediaStorage {
  list(bucket: string, folder: string, page: { limit: number; offset: number }): Promise<StorageEntry[]>;
  remove(bucket: string, paths: string[]): Promise<void>;
}

/**
 * Storage's own default page size. A larger request risks a server cap, and a
 * capped page would read as the last one.
 */
export const LIST_PAGE_SIZE = 100;

export const REMOVE_BATCH_SIZE = 100;

/** Every file under a folder, however deep, reading each folder page by page. */
export const listFilesUnder = async (storage: MediaStorage, bucket: string, folder: string): Promise<string[]> => {
  const files: string[] = [];
  const pending = [folder];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const page = await storage.list(bucket, current, { limit: LIST_PAGE_SIZE, offset });
      for (const entry of page) (entry.isFolder ? pending : files).push(`${current}/${entry.name}`);
      if (page.length < LIST_PAGE_SIZE) break;
    }
  }
  return files;
};

const AUTH_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Remove every file the account uploaded, bucket by bucket, in batches.
 * Resolves to an error message at the first failure, or null.
 *
 * Refuses anything but an auth user id. An empty one would make the account's
 * folder the bucket's root, and remove every file anyone ever uploaded.
 */
export const removeAccountMedia = async (storage: MediaStorage, authUserId: string): Promise<string | null> => {
  if (!AUTH_USER_ID.test(authUserId)) return `Refusing to remove media for account id "${authUserId}".`;
  try {
    for (const { bucket, prefix } of accountMediaPrefixes(authUserId)) {
      const files = await listFilesUnder(storage, bucket, prefix);
      for (let start = 0; start < files.length; start += REMOVE_BATCH_SIZE) {
        await storage.remove(bucket, files.slice(start, start + REMOVE_BATCH_SIZE));
      }
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
