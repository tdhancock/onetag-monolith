import React, { useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useApp } from '../../store/AppContext.native';
import { useAuthStatus } from '../../features/auth';
import { useCurrentProfile } from '../../features/profiles';
import {
  useContributorsQuery,
  useDeleteProject,
  useProjectProductsQuery,
  useProjectQuery,
  useSetProjectPublic,
  useUnlinkProduct,
  type Project,
  type ProjectProduct,
} from '../../features/projects';
import { useDestinationScanCountQuery } from '../../features/tags';
import DestinationActions from '../../components/native/DestinationActions';
import DetailSection from '../../components/native/DetailSection';
import ProjectContributors from '../../components/native/ProjectContributors';
import { RowSkeletons, SectionError } from '../../components/native/SectionStates';
import { Button, EmptyState, IconButton, ListRow, MonoLabel, Pressable, Sheet, SheetRow, Skeleton } from '../../components/native/ui';
import { DotsHorizontalIcon, XIcon } from '../../components/native/Icons';
import { onwardActionsFor } from '../../lib/screens/tagResolution';
import { productRoute } from '../../lib/screens/products';
import {
  canManageProject,
  deleteProjectConfirm,
  PRIVATE_LABEL,
  PROJECT_NOT_FOUND,
  productsEmptyState,
  projectAddContributorRoute,
  projectEditRoute,
  projectKindLabel,
  projectLinkProductRoute,
  projectRoute,
  projectStats,
  unlinkProductConfirm,
} from '../../lib/screens/projects';
import { color, space, type } from '../../theme/tokens';

/**
 * A Project (ONE-41): the core discovery page, where a scan turns into
 * exploration. Every section is a way onward — its owner, its contributors,
 * the products it used — because a page with nowhere to go next is the one
 * thing Waterfall Discovery forbids.
 *
 * A public project is readable by anyone, signed in or not. A private one
 * reaches only its owner and its contributors; to anyone else it reads as not
 * found, exactly like one that never existed.
 */
export default function ProjectScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const projectId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const auth = useAuthStatus();
  const { profileId } = useCurrentProfile();
  const { data: project, isPending, isError, refetch } = useProjectQuery(projectId);
  const [menuOpen, setMenuOpen] = useState(false);
  const deleteProject = useDeleteProject();

  const isOwner = canManageProject(profileId, project);

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: project?.name ?? 'Project',
        headerRight: isOwner
          ? () => (
              <IconButton
                icon={<DotsHorizontalIcon color={color.text} size={20} />}
                accessibilityLabel="Manage project"
                onPress={() => setMenuOpen(true)}
              />
            )
          : undefined,
      }}
    />
  );

  if (isPending && projectId) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <ProjectSkeleton />
      </SafeAreaView>
    );
  }

  // Just deleted by its owner, on the way back: say nothing rather than "not found".
  if (deleteProject.isSuccess) return <SafeAreaView style={styles.screen}>{header}</SafeAreaView>;

  if (isError || !project) {
    const onward = onwardActionsFor(auth).primary;
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <EmptyState
          title={isError ? "Couldn't load this project" : PROJECT_NOT_FOUND.title}
          body={isError ? 'Check your connection and try again.' : PROJECT_NOT_FOUND.body}
          action={
            isError
              ? { label: 'Try again', onPress: () => void refetch() }
              : { label: onward.label, onPress: () => router.replace(onward.route) }
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      {header}
      <ProjectDetail project={project} isOwner={isOwner} onRefreshProject={refetch} />
      {isOwner ? (
        <OwnerMenu
          project={project}
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          onDelete={() => deleteProject.mutateAsync(project)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function ProjectDetail({
  project,
  isOwner,
  onRefreshProject,
}: {
  project: Project;
  isOwner: boolean;
  onRefreshProject: () => Promise<unknown>;
}) {
  const router = useRouter();
  const { profileId } = useCurrentProfile();
  const contributors = useContributorsQuery(project.id);
  const products = useProjectProductsQuery(project.id);
  // Only the owner sees how often their tags pointing here were scanned.
  const scans = useDestinationScanCountQuery(profileId, { kind: 'project', id: project.id }, isOwner);
  const owner = project.owner;

  const openProfile = (username: string) => router.push(`/user/${encodeURIComponent(username)}`);
  const addContributor = () => router.push(projectAddContributorRoute(project.id));
  // Leaving a private project takes away the right to see it: go back rather
  // than land on its not-found state.
  const leftPrivateProject = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'));
  const stats =
    contributors.data && products.data
      ? projectStats({
          contributors: contributors.data.length,
          products: products.data.length,
          scans: isOwner ? scans.data ?? 0 : undefined,
        }).join(' · ')
      : null;

  // Pull to refresh re-reads everything on the page. Scan counts are the
  // owner's alone, so nobody else's refresh asks for them.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        onRefreshProject(),
        contributors.refetch(),
        products.refetch(),
        isOwner ? scans.refetch() : undefined,
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={color.textMuted} colors={[color.textMuted]} />
      }
    >
      {project.coverUrl ? (
        <Image
          source={{ uri: project.coverUrl }}
          style={styles.cover}
          contentFit="cover"
          transition={200}
          accessibilityLabel={`${project.name}, cover photo`}
        />
      ) : null}

      <View style={styles.intro}>
        <View style={styles.labels}>
          <MonoLabel color="textMid">{projectKindLabel(project)}</MonoLabel>
          {project.isPublic ? null : (
            <View style={styles.badge} accessible accessibilityLabel={PRIVATE_LABEL}>
              <MonoLabel color="inverse">{PRIVATE_LABEL}</MonoLabel>
            </View>
          )}
        </View>
        <Text style={styles.name} accessibilityRole="header">
          {project.name}
        </Text>
        {owner ? (
          <Pressable
            onPress={() => openProfile(owner.username)}
            accessibilityRole="link"
            accessibilityLabel={`By ${owner.name}, @${owner.username}`}
            hitSlop={12}
            style={styles.ownerHit}
          >
            <Text style={styles.owner}>
              By <Text style={styles.ownerName}>{owner.name}</Text>
            </Text>
          </Pressable>
        ) : null}
        {stats ? (
          <Text style={styles.stats} accessibilityLabel={stats}>
            {stats}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <DestinationActions
            target={{ kind: 'project', id: project.id }}
            title={project.name}
            route={projectRoute(project.id)}
          />
        </View>
        {project.description ? <Text style={styles.description}>{project.description}</Text> : null}
      </View>

      <DetailSection
        title="Contributors"
        trailing={
          isOwner && (contributors.data ?? []).length > 0 ? (
            <Button variant="outline" size="sm" onPress={addContributor} accessibilityLabel="Add a contributor">
              Add
            </Button>
          ) : null
        }
      >
        <ProjectContributors
          project={project}
          contributors={contributors.data}
          isPending={contributors.isPending}
          isError={contributors.isError}
          onRetry={() => void contributors.refetch()}
          isOwner={isOwner}
          profileId={profileId}
          onOpenProfile={openProfile}
          onAdd={addContributor}
          onLeftPrivateProject={leftPrivateProject}
        />
      </DetailSection>

      <DetailSection
        title="Products used"
        trailing={
          isOwner && (products.data ?? []).length > 0 ? (
            <Button variant="outline" size="sm" onPress={() => router.push(projectLinkProductRoute(project.id))}>
              Link a product
            </Button>
          ) : null
        }
      >
        <ProjectProducts
          project={project}
          links={products.data}
          isPending={products.isPending}
          isError={products.isError}
          onRetry={() => void products.refetch()}
          isOwner={isOwner}
        />
      </DetailSection>
    </ScrollView>
  );
}

const THUMB = 40;

function ProjectProducts({
  project,
  links,
  isPending,
  isError,
  onRetry,
  isOwner,
}: {
  project: Project;
  links: ProjectProduct[] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  isOwner: boolean;
}) {
  const router = useRouter();
  const { addToast } = useApp();
  const unlink = useUnlinkProduct();

  if (isPending) return <RowSkeletons count={2} />;
  if (isError) return <SectionError message="Couldn't load the products this project used." onRetry={onRetry} />;

  if (!links || links.length === 0) {
    const empty = productsEmptyState(isOwner);
    return (
      <View style={styles.pad}>
        <Text style={styles.emptyTitle}>{empty.title}</Text>
        <Text style={styles.emptyBody}>{empty.body}</Text>
        {isOwner ? (
          <Button
            variant="outline"
            size="sm"
            onPress={() => router.push(projectLinkProductRoute(project.id))}
            style={styles.emptyAction}
          >
            Link a product
          </Button>
        ) : null}
      </View>
    );
  }

  const confirmUnlink = (link: ProjectProduct) => {
    const confirm = unlinkProductConfirm(link.product.name);
    Alert.alert(confirm.title, confirm.body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: confirm.confirm,
        style: 'destructive',
        onPress: () =>
          unlink.mutate(
            { projectId: project.id, productId: link.product.id },
            { onError: () => addToast(`Couldn't remove ${link.product.name}. It's still here.`, 'error') },
          ),
      },
    ]);
  };

  return (
    <>
      {links.map((link, index) => (
        <ListRow
          key={link.linkId}
          title={link.product.name}
          subtitle={link.product.category ?? 'Product'}
          leading={
            link.product.imageUrl ? (
              <Image source={{ uri: link.product.imageUrl }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={styles.thumb} />
            )
          }
          trailing={
            isOwner ? (
              <IconButton
                icon={<XIcon color={color.textMid} size={18} />}
                accessibilityLabel={`Remove ${link.product.name} from this project`}
                onPress={() => confirmUnlink(link)}
              />
            ) : null
          }
          divider={index < links.length - 1}
          onPress={() => router.push(productRoute(link.product.id))}
        />
      ))}
    </>
  );
}

/**
 * The owner's own controls: edit, make private or public (the softer
 * alternative to deleting), and delete — which says what it destroys first.
 */
function OwnerMenu({
  project,
  visible,
  onClose,
  onDelete,
}: {
  project: Project;
  visible: boolean;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const router = useRouter();
  const { addToast } = useApp();
  const setPublic = useSetProjectPublic();

  const toggleVisibility = () => {
    onClose();
    setPublic.mutate(
      { project, isPublic: !project.isPublic },
      {
        onSuccess: () => addToast(project.isPublic ? 'Now private.' : 'Now public.', 'success'),
        onError: () => addToast("Couldn't change it. It's as it was.", 'error'),
      },
    );
  };

  const confirmDelete = () => {
    onClose();
    const confirm = deleteProjectConfirm(project);
    Alert.alert(confirm.title, confirm.body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: confirm.confirm,
        style: 'destructive',
        onPress: () =>
          onDelete().then(
            () => {
              addToast('Project deleted.', 'info');
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/profile');
            },
            () => addToast("Couldn't delete the project. It's still there.", 'error'),
          ),
      },
    ]);
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetRow
        label="Edit project"
        onPress={() => {
          onClose();
          router.push(projectEditRoute(project.id));
        }}
      />
      <SheetRow
        label={project.isPublic ? 'Make private' : 'Make public'}
        hint={
          project.isPublic
            ? 'Only you and its contributors will see it. Its tags lead others to not found.'
            : 'Anyone will be able to see it again.'
        }
        onPress={toggleVisibility}
      />
      <SheetRow label="Delete project" destructive onPress={confirmDelete} />
    </Sheet>
  );
}

/** The page's shape while the project loads. */
function ProjectSkeleton() {
  return (
    <View>
      <Skeleton style={styles.skeletonCover} />
      <View style={styles.intro}>
        <Skeleton width={140} height={10} />
        <Skeleton width="70%" height={22} style={styles.skeletonGap} />
        <Skeleton width={180} height={12} style={styles.skeletonGap} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  content: {
    paddingBottom: space.xxl,
  },
  cover: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: color.bgPanel,
  },
  intro: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  labels: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  badge: {
    backgroundColor: color.text,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
  },
  name: {
    marginTop: space.sm,
    fontFamily: type.bodyBold,
    fontSize: 17,
    lineHeight: 22,
    color: color.text,
  },
  ownerHit: {
    alignSelf: 'flex-start',
    marginTop: space.xs,
  },
  owner: {
    fontFamily: type.body,
    fontSize: 14,
    color: color.textMid,
  },
  ownerName: {
    fontFamily: type.bodyBold,
    color: color.text,
  },
  stats: {
    marginTop: space.sm,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
  actions: {
    marginTop: space.lg,
  },
  description: {
    marginTop: space.lg,
    fontFamily: type.body,
    fontSize: 15,
    lineHeight: 22,
    color: color.text,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    backgroundColor: color.bgPanel,
  },
  pad: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  emptyTitle: {
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: color.text,
  },
  emptyBody: {
    marginTop: space.xs,
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.textMid,
  },
  emptyAction: {
    marginTop: space.md,
    alignSelf: 'flex-start',
  },
  skeletonCover: {
    width: '100%',
    aspectRatio: 4 / 3,
  },
  skeletonGap: {
    marginTop: space.sm,
  },
});
