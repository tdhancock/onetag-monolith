// The public surface of the projects domain (ONE-41).
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
  createProject,
  updateProject,
  saveProjectEdits,
  deleteProject,
  linkProduct,
  unlinkProduct,
  mapProjectRow,
  mapContributorRow,
  PROJECT_SELECT,
  CONTRIBUTOR_SELECT,
} from './api';
// A project as a list shows it, shared with other features through services/.
export { mapProjectSummaryRow, PROJECT_SUMMARY_SELECT } from '../../services/projectRows';
export type { NewProjectInput, ProjectEdits } from './api';
export { projectKeys } from './keys';
export {
  useProjectQuery,
  useOwnedProjectsQuery,
  useContributedProjectsQuery,
  useProjectsUsingProductQuery,
  useContributorsQuery,
  useProjectProductsQuery,
} from './queries';
export {
  useCreateProject,
  useUpdateProject,
  useSetProjectPublic,
  useDeleteProject,
  useLinkProduct,
  useUnlinkProduct,
} from './mutations';
export type { UpdateProjectInput, ProjectVisibilityInput, ProductLinkInput } from './mutations';
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
