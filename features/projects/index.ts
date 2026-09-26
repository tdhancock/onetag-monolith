// The public surface of the projects domain (ONE-41), Contributors included (ONE-42).
//
// Screens and other features import from `features/projects`, never from a
// file inside it. See features/README.md.

export {
  fetchProject,
  fetchOwnedProjects,
  fetchContributedProjects,
  fetchProjectsUsingProduct,
  fetchContributors,
  fetchProjectProducts,
  searchPublicProjects,
  PROJECT_SEARCH_LIMIT,
  createProject,
  updateProject,
  saveProjectEdits,
  deleteProject,
  linkProduct,
  unlinkProduct,
  addContributor,
  removeContributor,
  updateContributor,
  mapProjectRow,
  mapContributorRow,
  PROJECT_SELECT,
  CONTRIBUTOR_SELECT,
} from './api';
// A project as a list shows it, shared with other features through services/.
export { mapProjectSummaryRow, PROJECT_SUMMARY_SELECT } from '../../services/projectRows';
export type { NewProjectInput, ProjectEdits, NewContributor, ContributorChanges } from './api';
export { projectKeys } from './keys';
export {
  useProjectQuery,
  useOwnedProjectsQuery,
  useContributedProjectsQuery,
  useProjectsUsingProductQuery,
  useContributorsQuery,
  useProjectProductsQuery,
  usePublicProjectSearchQuery,
} from './queries';
export {
  useCreateProject,
  useUpdateProject,
  useSetProjectPublic,
  useDeleteProject,
  useLinkProduct,
  useUnlinkProduct,
  useAddContributor,
  useRemoveContributor,
  useUpdateContributorRole,
  useSetContributorPublic,
} from './mutations';
export type {
  UpdateProjectInput,
  ProjectVisibilityInput,
  ProductLinkInput,
  ContributorRoleInput,
  ContributorVisibilityInput,
} from './mutations';
export type {
  Project,
  ProjectSummary,
  ProjectSummaryRow,
  ProjectProfile,
  ProjectProduct,
  Contributor,
  ProjectFields,
  ProjectRow,
  ContributorRow,
} from './types';
