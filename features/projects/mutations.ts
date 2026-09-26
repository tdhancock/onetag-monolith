// Write hooks for Projects (ONE-41) and their Contributors (ONE-42).
//
// None is optimistic: a project is created and edited on a form, deleted
// behind a confirmation, and a product is Linked from a picker that closes on
// success — places where waiting for the server is expected.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addContributor,
  createProject,
  deleteProject,
  linkProduct,
  removeContributor,
  saveProjectEdits,
  unlinkProduct,
  updateContributor,
  updateProject,
  type NewContributor,
  type NewProjectInput,
  type ProjectEdits,
} from './api';
import { projectKeys } from './keys';
import { saveKeys } from '../saves';
import type { Contributor, Project } from './types';
import type { AuthUserId } from '../../types';

const signedIn = (authUserId: AuthUserId | undefined): AuthUserId => {
  if (!authUserId) throw new Error('You must be signed in to change a project.');
  return authUserId;
};

/**
 * Create a project as the active profile. Resolves to its id. The cover is
 * filed under the account, so this takes the account's id as well.
 */
export const useCreateProject = (authUserId: AuthUserId | undefined) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewProjectInput) => createProject(signedIn(authUserId), input),
    onSuccess: (_projectId, input) =>
      queryClient.invalidateQueries({ queryKey: projectKeys.owned(input.ownerProfileId) }),
  });
};

export interface UpdateProjectInput {
  projectId: string;
  edits: ProjectEdits;
}

/** Save an edit to a project. Re-reads it whether or not the save went through. */
export const useUpdateProject = (authUserId: AuthUserId | undefined) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, edits }: UpdateProjectInput) => saveProjectEdits(signedIn(authUserId), projectId, edits),
    onSettled: (_data, _error, { projectId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) }),
        queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
      ]),
  });
};

export interface ProjectVisibilityInput {
  project: Pick<Project, 'id'>;
  isPublic: boolean;
}

/**
 * Make a project private, or public again: the softer alternative to
 * deleting it, which keeps its contributors, products, saves and tags.
 */
export const useSetProjectPublic = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, isPublic }: ProjectVisibilityInput) => updateProject(project.id, { isPublic }),
    onSettled: (_data, _error, { project }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: projectKeys.detail(project.id) }),
        queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
      ]),
  });
};

/**
 * Delete a project, for good. Its cached page reads as gone at once; every
 * project list and every profile's saves are re-read.
 */
export const useDeleteProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (project: Pick<Project, 'id'>) => deleteProject(project.id),
    onSuccess: (_data, project) => {
      queryClient.setQueryData(projectKeys.detail(project.id), null);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: saveKeys.all }),
      ]);
    },
  });
};

export interface ProductLinkInput {
  projectId: string;
  productId: string;
}

/** Re-read both sides of a product link: the project's products, and the product's projects. */
const invalidateLink = (queryClient: ReturnType<typeof useQueryClient>, { projectId, productId }: ProductLinkInput) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: projectKeys.products(projectId) }),
    queryClient.invalidateQueries({ queryKey: projectKeys.usingProduct(productId) }),
  ]);

/** Link a product to a project — any business's product. */
export const useLinkProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, productId }: ProductLinkInput) => linkProduct(projectId, productId),
    onSettled: (_data, _error, input) => invalidateLink(queryClient, input),
  });
};

/** Take a product off a project. */
export const useUnlinkProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, productId }: ProductLinkInput) => unlinkProduct(projectId, productId),
    onSettled: (_data, _error, input) => invalidateLink(queryClient, input),
  });
};

// ─── Contributors (ONE-42) ──────────────────────────────────────────────

/**
 * Re-read both directions of a contributor link: the project's contributors,
 * and the profile's contributed projects. The project itself too, since a
 * contributor who leaves a private one can no longer see it.
 */
const invalidateContributor = (
  queryClient: ReturnType<typeof useQueryClient>,
  { projectId, profileId }: { projectId: string; profileId: string },
) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: projectKeys.contributors(projectId) }),
    queryClient.invalidateQueries({ queryKey: projectKeys.contributed(profileId) }),
    queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) }),
  ]);

/** Link a profile to a project as a Contributor, with an optional role. */
export const useAddContributor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewContributor) => addContributor(input),
    onSettled: (_data, _error, input) => invalidateContributor(queryClient, input),
  });
};

/**
 * Remove a contributor link — the owner removing anyone, or a contributor
 * removing themselves ("Remove me from this project").
 */
export const useRemoveContributor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contributor: Pick<Contributor, 'id' | 'projectId' | 'profileId'>) => removeContributor(contributor.id),
    onSettled: (_data, _error, contributor) => invalidateContributor(queryClient, contributor),
  });
};

export interface ContributorRoleInput {
  contributor: Pick<Contributor, 'id' | 'projectId' | 'profileId'>;
  role: string | null;
}

/** Change a contributor's free-text role. */
export const useUpdateContributorRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contributor, role }: ContributorRoleInput) => updateContributor(contributor.id, { role }),
    onSettled: (_data, _error, { contributor }) => invalidateContributor(queryClient, contributor),
  });
};

export interface ContributorVisibilityInput {
  contributor: Pick<Contributor, 'id' | 'projectId' | 'profileId'>;
  isPublic: boolean;
}

/**
 * Show a contributor link to everyone who can see the project, or hide it
 * from all but the owner and that contributor.
 */
export const useSetContributorPublic = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contributor, isPublic }: ContributorVisibilityInput) =>
      updateContributor(contributor.id, { isPublic }),
    onSettled: (_data, _error, { contributor }) => invalidateContributor(queryClient, contributor),
  });
};
