// The public surface of the profiles domain.
//
// Screens and other features import from `features/profiles`, never from a
// file inside it. See features/README.md.

export {
  mapProfileRow,
  mapProfileUpdatesToRow,
  getUserProfile,
  getUserPosts,
  getUserReposts,
  updateUserProfileData,
  uploadAvatar,
  getFollowerCount,
  getFollowingCount,
  getFollowingList,
  getFollowerUsers,
  getFollowingUsers,
  followUser,
  unfollowUser,
  checkUsernameExists,
  searchUsers,
  getSmartUserSuggestions,
} from './api';

export { profileKeys } from './keys';

export type { UserProfile, SimpleUser, ProfileRow, ProfileUpdates } from './types';

export {
  useCurrentUserQuery,
  useProfileQuery,
  useProfilePostsQuery,
  useProfileRepostsQuery,
  useFollowersQuery,
  useFollowingQuery,
  useFollowCountsQuery,
  useFollowingUsernamesQuery,
  useFollowState,
  useUserSuggestionsQuery,
  PLACEHOLDER_PROFILE,
} from './queries';
export type { FollowCounts } from './queries';

export { useToggleFollow, useUpdateProfile, useUploadAvatar } from './mutations';
export type { FollowToggle, FollowTarget } from './mutations';
