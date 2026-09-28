// The public surface of the profiles domain.
//
// Screens and other features import from `features/profiles`, never from a
// file inside it. See features/README.md.

export {
  mapProfileRow,
  mapProfileUpdatesToRow,
  getUserProfile,
  getUserPosts,
  getUserPostCount,
  updateUserProfileData,
  uploadAvatar,
  getFollowerCount,
  getFollowingCount,
  getFollowingList,
  getFollowerUsers,
  getFollowingUsers,
  followUser,
  unfollowUser,
  getRequestedList,
  requestFollow,
  cancelFollowRequest,
  fetchFollowRequests,
  approveFollowRequest,
  declineFollowRequest,
  checkUsernameExists,
  searchUsers,
  getSmartUserSuggestions,
  fetchMyProfiles,
  updateBusinessProfile,
  mapBusinessUpdatesToRow,
  PROFILE_SELECT,
  createProfile,
  createProfileFailureFor,
  CreateProfileError,
} from './api';
export type { NewProfile, CreateProfileFailure } from './api';

export { profileKeys, activeProfileKeys } from './keys';
export {
  activeProfileStorageKey,
  readActiveProfileId,
  chooseActiveProfile,
  isProfileScoped,
  isProfileSwitch,
  resetProfileScopedQueries,
  useProfileSwitchReset,
} from './activeProfile';
export type { ActingIdentity } from './activeProfile';

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
  FollowRequest,
} from './types';
export { asAuthUserId, asProfileId } from './types';

export {
  useMyProfilesQuery,
  useActiveProfileIdQuery,
  useCurrentProfile,
  resolveCurrentProfile,
  useProfileQuery,
  useProfilePostsQuery,
  useProfilePostCountQuery,
  useFollowersQuery,
  useFollowingQuery,
  useFollowCountsQuery,
  useFollowingUsernamesQuery,
  useFollowState,
  useRequestedUsernamesQuery,
  useFollowRequestsQuery,
  useUserSuggestionsQuery,
  useProfileSearchQuery,
  PROFILE_SEARCH_MIN_LENGTH,
  PLACEHOLDER_PROFILE,
} from './queries';
export type { FollowCounts, CurrentProfile, CurrentProfileStatus, ProfileSearchResult } from './queries';

export {
  useToggleFollow,
  useApproveFollowRequest,
  useDeclineFollowRequest,
  useUpdateProfile,
  useUpdateBusinessProfile,
  useUploadAvatar,
  useSetActiveProfile,
  setActiveProfile,
  useCreateProfile,
} from './mutations';
export type { FollowToggle, FollowTarget } from './mutations';
