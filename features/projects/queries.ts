// Read hooks for Projects (ONE-41).

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  fetchContributedProjects,
  fetchContributors,
  fetchOwnedProjects,
  fetchProject,
  fetchProjectProducts,
  fetchProjectsUsingProduct,
  searchPublicProjects,
} from './api';
import { projectKeys } from './keys';
import type { Contributor, Project, ProjectProduct, ProjectSummary } from './types';

/**
 * One project. `data` is null when there is none the viewer may see — deleted,
 * never there, or private to others. Needs no session for a public project.
 */
export const useProjectQuery = (projectId: string | undefined) =>
  useQuery<Project | null>({
    queryKey: projectKeys.detail(projectId ?? ''),
    queryFn: () => fetchProject(projectId!),
    enabled: Boolean(projectId),
  });

/** The projects a profile owns that the viewer may see, newest first. */
export const useOwnedProjectsQuery = (ownerProfileId: string | undefined) =>
  useQuery<ProjectSummary[]>({
    queryKey: projectKeys.owned(ownerProfileId ?? ''),
    queryFn: () => fetchOwnedProjects(ownerProfileId!),
    enabled: Boolean(ownerProfileId),
  });

/** The projects a profile contributed to that the viewer may see, newest first. */
export const useContributedProjectsQuery = (contributorProfileId: string | undefined) =>
  useQuery<ProjectSummary[]>({
    queryKey: projectKeys.contributed(contributorProfileId ?? ''),
    queryFn: () => fetchContributedProjects(contributorProfileId!),
    enabled: Boolean(contributorProfileId),
  });

/** The projects that Link a product — "Used in projects" on its page. */
export const useProjectsUsingProductQuery = (productId: string | undefined) =>
  useQuery<ProjectSummary[]>({
    queryKey: projectKeys.usingProduct(productId ?? ''),
    queryFn: () => fetchProjectsUsingProduct(productId!),
    enabled: Boolean(productId),
  });

/** A project's contributors the viewer may see, in the order they were added. */
export const useContributorsQuery = (projectId: string | undefined) =>
  useQuery<Contributor[]>({
    queryKey: projectKeys.contributors(projectId ?? ''),
    queryFn: () => fetchContributors(projectId!),
    enabled: Boolean(projectId),
  });

/** The products a project Links. */
export const useProjectProductsQuery = (projectId: string | undefined) =>
  useQuery<ProjectProduct[]>({
    queryKey: projectKeys.products(projectId ?? ''),
    queryFn: () => fetchProjectProducts(projectId!),
    enabled: Boolean(projectId),
  });

/**
 * Public projects by name from every account, for the composer's tag picker
 * (ONE-46). The last results stay up while the next search runs.
 */
export const usePublicProjectSearchQuery = (query: string) =>
  useQuery<ProjectSummary[]>({
    queryKey: projectKeys.search(query.trim()),
    queryFn: () => searchPublicProjects(query),
    placeholderData: keepPreviousData,
  });
