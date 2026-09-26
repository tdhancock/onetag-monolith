// The public surface of the saves domain (ONE-39).
//
// Screens and other features import from `features/saves`, never from a file
// inside it. See features/README.md.

export {
  fetchSaves,
  saveTarget,
  unsaveTarget,
  toggleSave,
  getSavedPosts,
  fetchSavedItems,
  mapSaveRow,
  saveKeyOf,
  targetOfSaveKey,
  SAVE_TARGET_COLUMN,
  SAVE_SELECT,
} from './api';
export { saveKeys } from './keys';
export { useSavesQuery, useIsSaved, useSavedItemsQuery } from './queries';
export { useToggleSave, saveToggleConfig, shouldSaveAfterFlip } from './mutations';
export type { SaveToggle } from './mutations';
export type { Save, SaveKind, SaveRow, SaveTarget, SavedItem, SavedProfile } from './types';
