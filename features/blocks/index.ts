// The public surface of the blocks domain.
//
// Screens and other features import from `features/blocks`, never from a file
// inside it. See features/README.md.

export { fetchBlocks, blockUser, unblockUser, importLocalBlocks, resolveUsernames } from './api';

export { blockKeys } from './keys';

export { useBlocksQuery, useBlockedUsers } from './queries';

export { migrateLocalBlocks, LOCAL_BLOCKS_KEY } from './localMigration';
export type { BlockListStore } from './localMigration';

export { useBlockToggle } from './mutations';
export type { BlockToggle, BlockTarget } from './mutations';

export type { BlockedUser } from './types';
