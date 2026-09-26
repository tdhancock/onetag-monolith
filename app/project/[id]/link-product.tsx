import React, { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useApp } from '../../../store/AppContext.native';
import { useCurrentProfile } from '../../../features/profiles';
import { useProductSearchQuery, type ProductSearchResult } from '../../../features/products';
import { useLinkProduct, useProjectProductsQuery, useProjectQuery } from '../../../features/projects';
import ModalHeader from '../../../components/native/ModalHeader';
import { RowSkeletons, SectionError } from '../../../components/native/SectionStates';
import { EmptyState, ListRow, TextField } from '../../../components/native/ui';
import { SearchIcon } from '../../../components/native/Icons';
import { useDebouncedValue } from '../../../lib/useDebouncedValue';
import { canManageProject, PROJECT_NOT_FOUND } from '../../../lib/screens/projects';
import { color, space, type } from '../../../theme/tokens';

const THUMB = 40;

/**
 * Link products to a project (ONE-41): a search across every business's
 * products, not only the owner's — a builder's project showcasing other
 * businesses' products is the point of Waterfall Discovery. The link is the
 * project owner's to make. Products already Linked are left out, and the
 * picker stays open so several can be Linked in turn.
 */
export default function LinkProductScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const projectId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const { addToast } = useApp();
  const { profileId } = useCurrentProfile();
  const { data: project, isPending } = useProjectQuery(projectId);
  const linked = useProjectProductsQuery(projectId);
  const [query, setQuery] = useState('');
  const search = useProductSearchQuery(useDebouncedValue(query));
  const link = useLinkProduct();

  const close = () => router.back();
  const header = <ModalHeader title="Link a product" onSave={close} canSave saveLabel="Done" />;

  if (isPending) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <ActivityIndicator style={styles.loading} color={color.textMuted} accessibilityLabel="Loading" />
      </SafeAreaView>
    );
  }

  if (!project || !canManageProject(profileId, project)) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <EmptyState
          title={project ? "You can't change this project" : PROJECT_NOT_FOUND.title}
          body={project ? 'Only the profile that owns it can Link products.' : PROJECT_NOT_FOUND.body}
          action={{ label: 'Back', onPress: close }}
        />
      </SafeAreaView>
    );
  }

  const linkedIds = new Set((linked.data ?? []).map((item) => item.product.id));
  const results = (search.data ?? []).filter((product) => !linkedIds.has(product.id));

  const choose = (product: ProductSearchResult) =>
    link.mutate(
      { projectId: project.id, productId: product.id },
      {
        onSuccess: () => addToast(`Linked ${product.name}.`, 'success'),
        onError: () => addToast(`Couldn't Link ${product.name}. Try again.`, 'error'),
      },
    );

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      <View style={styles.search}>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="Search products by name"
          autoCapitalize="none"
          autoCorrect={false}
          leading={<SearchIcon color={color.textMuted} size={18} />}
          accessibilityLabel="Search products"
        />
        <Text style={styles.hint}>Any business's products, not only yours.</Text>
      </View>
      <FlatList
        data={results}
        keyExtractor={(product) => product.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }) => (
          <ListRow
            title={item.name}
            subtitle={[item.category, item.businessName].filter(Boolean).join(' · ') || 'Product'}
            leading={
              item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={styles.thumb} />
              )
            }
            accessibilityLabel={`Link ${item.name}${item.businessName ? `, by ${item.businessName}` : ''}`}
            divider={index < results.length - 1}
            onPress={() => choose(item)}
          />
        )}
        ListEmptyComponent={
          search.isPending ? (
            <RowSkeletons />
          ) : search.isError ? (
            <SectionError message="Couldn't search products." onRetry={() => void search.refetch()} />
          ) : (
            <EmptyState
              title={query.trim() ? 'No products match' : 'No products to Link yet'}
              body={query.trim() ? 'Try another name.' : 'Products businesses list on OneTag show up here.'}
            />
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  loading: {
    marginTop: space.xxl,
  },
  search: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  hint: {
    marginTop: space.xs,
    fontFamily: type.body,
    fontSize: 13,
    color: color.textMid,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    backgroundColor: color.bgPanel,
  },
});
