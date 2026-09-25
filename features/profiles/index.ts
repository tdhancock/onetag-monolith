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
  fetchMyProfiles,
  updateBusinessProfile,
  mapBusinessUpdatesToRow,
  PROFILE_SELECT,
} from './api';

export { profileKeys } from './keys';

export type {
  UserProfile,
  SimpleUser,
  ProfileRow,
  ProfileUpdates,
  ProfileType,
  AuthUserId,
  ProfileId,
  BusinessProfileFields,
  BusinessProfileRow,
  BusinessProfileUpdates,
} from './types';
export { asAuthUserId, asProfileId } from './types';

export {
  useMyProfilesQuery,
  useCurrentProfile,
  resolveCurrentProfile,
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
export type { FollowCounts, CurrentProfile, CurrentProfileStatus } from './queries';

export { useToggleFollow, useUpdateProfile, useUpdateBusinessProfile, useUploadAvatar } from './mutations';
export type { FollowToggle, FollowTarget } from './mutations';
