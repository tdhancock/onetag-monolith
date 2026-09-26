import React, { useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useApp } from '../../store/AppContext.native';
import { useAuthStatus } from '../../features/auth';
import { useCurrentProfile } from '../../features/profiles';
import {
  useDeleteProduct,
  useProductProjectsQuery,
  useProductQuery,
  useSetProductAvailable,
  type Product,
  type ProductProject,
} from '../../features/products';
import DestinationActions from '../../components/native/DestinationActions';
import DetailSection from '../../components/native/DetailSection';
import ProductGallery from '../../components/native/ProductGallery';
import { RowSkeletons, SectionError } from '../../components/native/SectionStates';
import { EmptyState, IconButton, ListRow, MonoLabel, Sheet, SheetRow, Skeleton } from '../../components/native/ui';
import { DotsHorizontalIcon } from '../../components/native/Icons';
import { onwardActionsFor } from '../../lib/screens/tagResolution';
import {
  canManageProduct,
  deleteProductConfirm,
  formatPrice,
  PRODUCT_NOT_FOUND,
  PRODUCT_PROJECTS_EMPTY,
  productEditRoute,
  productKindLabel,
  productRoute,
  UNAVAILABLE_LABEL,
} from '../../lib/screens/products';
import { color, space, type } from '../../theme/tokens';

/**
 * A Product (ONE-40): a discovery node, not a storefront. Its photos, what it
 * is, and — the reason the page exists — where to go next: the business that
 * lists it and the projects that use it. A price, when there is one, is
 * information; there is nothing to buy here.
 *
 * Readable by anyone, signed in or not: a stranger who scanned a tag lands
 * here with no account, and nothing on the page assumes one. The business
 * that lists it manages it from the ⋯ menu.
 */
export default function ProductScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const productId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const auth = useAuthStatus();
  const { profileId } = useCurrentProfile();
  const { data: product, isPending, isError, refetch } = useProductQuery(productId);
  const [menuOpen, setMenuOpen] = useState(false);
  const deleteProduct = useDeleteProduct();

  const isOwner = canManageProduct(profileId, product);

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: product?.name ?? 'Product',
        headerRight: isOwner
          ? () => (
              <IconButton
                icon={<DotsHorizontalIcon color={color.text} size={20} />}
                accessibilityLabel="Manage product"
                onPress={() => setMenuOpen(true)}
              />
            )
          : undefined,
      }}
    />
  );

  if (isPending && productId) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <ProductSkeleton />
      </SafeAreaView>
    );
  }

  // Just deleted by its owner, on the way back: say nothing rather than "not found".
  if (deleteProduct.isSuccess) return <SafeAreaView style={styles.screen}>{header}</SafeAreaView>;

  if (isError || !product) {
    const onward = onwardActionsFor(auth).primary;
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <EmptyState
          title={isError ? "Couldn't load this product" : PRODUCT_NOT_FOUND.title}
          body={isError ? 'Check your connection and try again.' : PRODUCT_NOT_FOUND.body}
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
      <ProductDetail product={product} onRefreshProduct={refetch} />
      {isOwner ? (
        <OwnerMenu
          product={product}
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          onDelete={() => deleteProduct.mutateAsync(product)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function ProductDetail({ product, onRefreshProduct }: { product: Product; onRefreshProduct: () => Promise<unknown> }) {
  const router = useRouter();
  const projects = useProductProjectsQuery(product.id);
  const price = formatPrice(product.priceCents, product.currency);
  const business = product.business;

  // Pull to refresh re-reads the product and the projects that use it.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([onRefreshProduct(), projects.refetch()]);
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
      <ProductGallery media={product.media} name={product.name} />

      <View style={styles.intro}>
        <View style={styles.labels}>
          <MonoLabel color="textMid">{productKindLabel(product)}</MonoLabel>
          {product.available ? null : (
            <View style={styles.badge} accessible accessibilityLabel={UNAVAILABLE_LABEL}>
              <MonoLabel color="inverse">{UNAVAILABLE_LABEL}</MonoLabel>
            </View>
          )}
        </View>
        <Text style={styles.name} accessibilityRole="header">
          {product.name}
        </Text>
        {price ? (
          <Text style={styles.price} accessibilityLabel={`Price, ${price}`}>
            {price}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <DestinationActions
            target={{ kind: 'product', id: product.id }}
            title={product.name}
            route={productRoute(product.id)}
          />
        </View>
        {product.description ? <Text style={styles.description}>{product.description}</Text> : null}
      </View>

      {product.specs.length > 0 ? (
        <DetailSection title="Specs">
          {product.specs.map((spec, index) => (
            <View
              key={spec.id}
              style={[styles.spec, index < product.specs.length - 1 && styles.specDivider]}
              accessible
              accessibilityLabel={`${spec.label}, ${spec.value}`}
            >
              <Text style={styles.specLabel}>{spec.label}</Text>
              <Text style={styles.specValue}>{spec.value}</Text>
            </View>
          ))}
        </DetailSection>
      ) : null}

      {business ? (
        <DetailSection title="Listed by">
          <ListRow
            title={business.name}
            subtitle={`@${business.username}`}
            avatarUri={business.avatarUrl}
            verified={business.isVerified}
            onPress={() => router.push(`/user/${encodeURIComponent(business.username)}`)}
          />
        </DetailSection>
      ) : null}

      <DetailSection title="Used in projects">
        {projects.isPending ? (
          <RowSkeletons count={2} />
        ) : projects.isError ? (
          <SectionError message="Couldn't load the projects that use it." onRetry={() => void projects.refetch()} />
        ) : (projects.data ?? []).length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{PRODUCT_PROJECTS_EMPTY.title}</Text>
            <Text style={styles.emptyBody}>{PRODUCT_PROJECTS_EMPTY.body}</Text>
          </View>
        ) : (
          (projects.data ?? []).map((project, index, all) => (
            <ProjectRow
              key={project.id}
              project={project}
              divider={index < all.length - 1}
              onPress={() => router.push(`/project/${encodeURIComponent(project.id)}`)}
            />
          ))
        )}
      </DetailSection>
    </ScrollView>
  );
}

const COVER_SIZE = 40;

function ProjectRow({ project, divider, onPress }: { project: ProductProject; divider: boolean; onPress: () => void }) {
  return (
    <ListRow
      title={project.name}
      subtitle={[project.projectType, project.year].filter(Boolean).join(' · ') || 'Project'}
      leading={
        project.coverUrl ? (
          <Image source={{ uri: project.coverUrl }} style={styles.cover} contentFit="cover" />
        ) : (
          <View style={styles.cover} />
        )
      }
      divider={divider}
      onPress={onPress}
    />
  );
}

/**
 * The business's own controls: edit, take the product down or put it back,
 * and delete it — which says what it destroys before anything is removed.
 */
function OwnerMenu({
  product,
  visible,
  onClose,
  onDelete,
}: {
  product: Product;
  visible: boolean;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const router = useRouter();
  const { addToast } = useApp();
  const setAvailable = useSetProductAvailable();

  const toggleAvailable = () => {
    onClose();
    setAvailable.mutate(
      { product, available: !product.available },
      {
        onSuccess: () => addToast(product.available ? 'Marked unavailable.' : 'Available again.', 'success'),
        onError: () => addToast("Couldn't change it. It's as it was.", 'error'),
      },
    );
  };

  const confirmDelete = () => {
    onClose();
    const confirm = deleteProductConfirm(product);
    Alert.alert(confirm.title, confirm.body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: confirm.confirm,
        style: 'destructive',
        onPress: () =>
          onDelete().then(
            () => {
              addToast('Product deleted.', 'info');
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/profile');
            },
            () => addToast("Couldn't delete the product. It's still there.", 'error'),
          ),
      },
    ]);
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetRow
        label="Edit product"
        onPress={() => {
          onClose();
          router.push(productEditRoute(product.id));
        }}
      />
      <SheetRow
        label={product.available ? 'Mark unavailable' : 'Mark available'}
        hint={
          product.available
            ? 'Keeps its page, tags and saves, and says it is no longer available.'
            : 'Shows it as available again.'
        }
        onPress={toggleAvailable}
      />
      <SheetRow label="Delete product" destructive onPress={confirmDelete} />
    </Sheet>
  );
}

/** The page's shape while the product loads. */
function ProductSkeleton() {
  return (
    <View>
      <Skeleton style={styles.skeletonImage} />
      <View style={styles.intro}>
        <Skeleton width={120} height={10} />
        <Skeleton width="70%" height={22} style={styles.skeletonGap} />
        <Skeleton width={80} height={16} style={styles.skeletonGap} />
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
  price: {
    marginTop: space.xs,
    fontFamily: type.bodyMedium,
    fontSize: 15,
    color: color.text,
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
  spec: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.lg,
    marginHorizontal: space.lg,
    paddingVertical: space.md,
  },
  specDivider: {
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  specLabel: {
    fontFamily: type.body,
    fontSize: 14,
    color: color.textMid,
  },
  specValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: type.bodyMedium,
    fontSize: 14,
    color: color.text,
  },
  cover: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    backgroundColor: color.bgPanel,
  },
  empty: {
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
  skeletonImage: {
    width: '100%',
    aspectRatio: 1,
  },
  skeletonGap: {
    marginTop: space.sm,
  },
});
