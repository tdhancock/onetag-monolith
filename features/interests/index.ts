// The public surface of the interests domain.
//
// Screens and other features import from `features/interests`, never from a
// file inside it. See features/README.md.

export { fetchInterests } from './api';
export { interestKeys } from './keys';
export { useInterestsQuery } from './queries';
export type { Interest } from './types';
