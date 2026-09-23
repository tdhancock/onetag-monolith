// The one-time move of a device-local block list into the database.
//
// Before ONE-54 a block was a username in an AsyncStorage array under
// `onetag-blocked-users`. Someone who blocked an account last week must not
// be silently un-blocked by updating the app, so on the first run after this
// lands the stored list is imported and only then is the key cleared.
//
// Written against a minimal storage interface rather than importing
// AsyncStorage directly, so the provider passes the real store and the tests
// pass a fake one — what runs in the app is what is under test.

import { importLocalBlocks } from './api';

/** Where the device-local list lived. */
export const LOCAL_BLOCKS_KEY = 'onetag-blocked-users';

/** The slice of AsyncStorage this needs. */
export interface BlockListStore {
  getItem: (key: string) => Promise<string | null>;
  removeItem: (key: string) => Promise<void>;
}

/** Usernames out of whatever was stored, ignoring anything that is not one. */
const parseStoredUsernames = (stored: string): string[] => {
  const parsed = JSON.parse(stored);

  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
};

/**
 * Import the device-local block list, once, and clear it.
 *
 * Resolves to the number of blocks imported, or `null` when there was nothing
 * stored — which is the normal case on every run after the first.
 *
 * The key is removed **after** the import resolves. An import that throws —
 * offline, say — leaves the key in place so the next launch tries again, and
 * a corrupt payload is dropped rather than throwing on boot.
 */
export const migrateLocalBlocks = async (
  store: BlockListStore,
  blockerId: string,
  importBlocks: (blockerId: string, usernames: string[]) => Promise<number> = importLocalBlocks,
): Promise<number | null> => {
  try {
    const stored = await store.getItem(LOCAL_BLOCKS_KEY);
    if (stored === null) return null;

    const usernames = parseStoredUsernames(stored);
    const imported = usernames.length > 0 ? await importBlocks(blockerId, usernames) : 0;

    await store.removeItem(LOCAL_BLOCKS_KEY);
    return imported;
  } catch (error) {
    console.error('Could not migrate locally blocked users', error);
    return null;
  }
};
