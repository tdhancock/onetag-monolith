// The public surface of the moderation domain.
//
// Two writes and no reads, so no keys, queries or mutations — the report
// sheets call these directly and confirm on their own. See features/README.md.

export { reportPost, reportUser } from './api';
export type { ReportTargetType } from './types';
