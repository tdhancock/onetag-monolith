// The public surface of the projects domain (ONE-41), Contributors included (ONE-42).
//
// Screens and other features import from `features/projects`, never from a
// file inside it. See features/README.md.

export {
  fetchProject,
  fetchOwnedProjects,
  fetchChildProjects,
  fetchContributedProjects,
  fetchProjectsUsingProduct,
  fetchContributors,
  fetchProjectProducts,
  fetchProjectLog,
  createProject,
  updateProject,
  saveProjectEdits,
  saveProjectDetails,
  deleteProject,
  linkProduct,
  unlinkProduct,
  addContributor,
  removeContributor,
  updateContributor,
  createLogEntry,
  saveLogEntryEdits,
  deleteLogEntry,
  removeMeFromLogEntry,
  mapProjectRow,
  mapContributorRow,
  mapLogEntryRow,
  PROJECT_SELECT,
  CONTRIBUTOR_SELECT,
  LOG_ENTRY_SELECT,
} from './api';
// A project as a list shows it, shared with other features through services/.
export { mapProjectSummaryRow, PROJECT_SUMMARY_SELECT } from '../../services/projectRows';
export type {
  NewProjectInput,
  ProjectEdits,
  ProjectDetailEdit,
  NewContributor,
  ContributorChanges,
  NewLogEntryInput,
  LogEntryEdits,
} from './api';
export { projectKeys } from './keys';
export {
  useProjectQuery,
  useOwnedProjectsQuery,
  useChildProjectsQuery,
  useContributedProjectsQuery,
  useProjectsUsingProductQuery,
  useContributorsQuery,
  useProjectProductsQuery,
  useProjectLogQuery,
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
  useCreateLogEntry,
  useUpdateLogEntry,
  useDeleteLogEntry,
  useRemoveMeFromLogEntry,
} from './mutations';
export type {
  UpdateProjectInput,
  ProjectVisibilityInput,
  ProductLinkInput,
  ContributorRoleInput,
  ContributorVisibilityInput,
  UpdateLogEntryInput,
} from './mutations';
export type {
  Project,
  ProjectParent,
  ProjectDetail,
  ProjectDetailInput,
  ProjectDetailKind,
  ProjectLogEntry,
  ProjectLogEntryFields,
  ProjectLogPhoto,
  ProjectSummary,
  ProjectSummaryRow,
  ProjectProfile,
  ProjectProduct,
  Contributor,
  ProjectFields,
  ProjectRow,
  ContributorRow,
} from './types';
