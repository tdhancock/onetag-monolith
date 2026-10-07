// What the account owns and so may point a Physical or Digital Tag at
// (ONE-89): its profiles, its business profile's products, every project its
// profiles own, and the posts of the profile it's acting as. Read once here
// for the screens that offer them — the create flow (ONE-32) and linking a
// blank tag (ONE-139) — so the two can never disagree about what is offered.

import { useMemo } from 'react';
import { useCurrentProfile, useMyProfilesQuery, useProfilePostsQuery } from '../features/profiles';
import { useBusinessProductsQuery } from '../features/products';
import { useOwnedProjectsQuery, type ProjectSummary } from '../features/projects';
import { destinationSections, postChoices, type DestinationSection } from './screens/tags';

export interface OwnedTagDestinations {
  /** Only destinations the account owns: one RLS would refuse is never offered. */
  sections: DestinationSection[];
  /** Everything has been read, so a pre-fill can be checked against it. */
  loaded: boolean;
  /** Every project the account owns, children included, as read for the picker. */
  projects: ProjectSummary[];
}

/**
 * The picker's sections. `wantedPost` keeps a post offered that is older
 * than the newest few, when a screen arrives wanting it.
 */
export const useOwnedTagDestinations = (wantedPost?: string): OwnedTagDestinations => {
  const { profileId, authUserId } = useCurrentProfile();
  const { data: profiles } = useMyProfilesQuery(authUserId);

  const business = profiles?.find((profile) => profile.profileType === 'business');
  const individual = profiles?.find((profile) => profile.profileType !== 'business');
  const products = useBusinessProductsQuery(business?.id);
  const businessProjects = useOwnedProjectsQuery(business?.id);
  const individualProjects = useOwnedProjectsQuery(individual?.id);
  const posts = useProfilePostsQuery(profileId);
  // A query with no profile to ask about never runs, so it is not waited on.
  const loaded =
    Boolean(profiles) &&
    !products.isLoading &&
    !businessProjects.isLoading &&
    !individualProjects.isLoading &&
    !posts.isLoading;

  const projects = useMemo(
    () => [...(businessProjects.data ?? []), ...(individualProjects.data ?? [])],
    [businessProjects.data, individualProjects.data],
  );
  const sections = useMemo(
    () => destinationSections(profiles ?? [], products.data ?? [], projects, postChoices(posts.data ?? [], wantedPost)),
    [profiles, products.data, projects, posts.data, wantedPost],
  );

  return { sections, loaded, projects };
};
