import React from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from '@tanstack/react-form';
import { useApp } from '../../../store/AppContext.native';
import { useCurrentProfile } from '../../../features/profiles';
import { useProductQuery, useUpdateProduct } from '../../../features/products';
import { MediaUploadError } from '../../../services/mediaUpload';
import KeyboardAvoider from '../../../components/native/KeyboardAvoider';
import FormScrollView from '../../../components/native/FormScrollView';
import ModalHeader from '../../../components/native/ModalHeader';
import ProductForm, { productFormOptions } from '../../../components/native/ProductForm';
import { useAppForm } from '../../../components/native/form';
import { EmptyState } from '../../../components/native/ui';
import {
  canManageProduct,
  PRODUCT_PHOTO_FAILED,
  PRODUCT_SAVE_FAILED,
  productDraftChanged,
  productDraftFrom,
  productEditsFrom,
} from '../../../lib/screens/products';
import type { Product } from '../../../features/products';
import { color, space } from '../../../theme/tokens';

/**
 * Edit a product (ONE-40): its photos and their order, its fields and its
 * specs and theirs. A modal, declared in app/_layout.tsx. Only the business
 * profile that lists the product gets the form.
 */
export default function EditProductScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const productId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const { profileId } = useCurrentProfile();
  const { data: product, isPending } = useProductQuery(productId);

  const close = () => router.back();

  if (isPending) {
    return (
      <SafeAreaView style={styles.screen}>
        <ModalHeader title="Edit product" onCancel={close} onSave={() => undefined} canSave={false} />
        <ActivityIndicator style={styles.loading} color={color.textMuted} accessibilityLabel="Loading" />
      </SafeAreaView>
    );
  }

  if (!product || !canManageProduct(profileId, product)) {
    return (
      <SafeAreaView style={styles.screen}>
        <ModalHeader title="Edit product" onCancel={close} onSave={() => undefined} canSave={false} />
        <EmptyState
          title={product ? "You can't edit this product" : 'Product not found'}
          body={
            product
              ? 'Only the business profile that listed it can. Switch to it to make changes.'
              : 'It may have been removed.'
          }
          action={{ label: 'Back', onPress: close }}
        />
      </SafeAreaView>
    );
  }

  return <EditProductForm product={product} onDone={close} />;
}

/**
 * The form, once the product has loaded. It starts from the product; a
 * refetch moves it along until the owner starts typing, and never after.
 */
function EditProductForm({ product, onDone }: { product: Product; onDone: () => void }) {
  const { addToast } = useApp();
  const { authUserId } = useCurrentProfile();
  const updateProduct = useUpdateProduct(authUserId);
  const form = useAppForm({
    ...productFormOptions,
    defaultValues: productDraftFrom(product),
    onSubmit: ({ value }) =>
      updateProduct.mutate(
        { product, edits: productEditsFrom(value, product) },
        {
          onSuccess: () => {
            addToast('Saved.', 'success');
            onDone();
          },
          onError: (error) =>
            addToast(error instanceof MediaUploadError ? PRODUCT_PHOTO_FAILED : PRODUCT_SAVE_FAILED, 'error'),
        },
      ),
  });
  const valid = useStore(form.store, (state) => state.canSubmit);
  // Save waits for something to save, not just for a valid draft.
  const changed = useStore(form.store, (state) => productDraftChanged(state.values, product));

  const canSave = valid && changed && !updateProduct.isPending;
  const handleSave = () => {
    if (canSave) void form.handleSubmit();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ModalHeader
        title="Edit product"
        onCancel={onDone}
        onSave={handleSave}
        canSave={canSave}
        saving={updateProduct.isPending}
      />
      <KeyboardAvoider style={styles.fill}>
        <FormScrollView style={styles.fill} contentContainerStyle={styles.scroll}>
          <ProductForm form={form} />
        </FormScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  fill: {
    flex: 1,
  },
  loading: {
    marginTop: space.xxl,
  },
  scroll: {
    paddingBottom: space.xxl,
  },
});
