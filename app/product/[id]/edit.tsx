import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../../store/AppContext.native';
import { useCurrentProfile } from '../../../features/profiles';
import { useProductQuery, useUpdateProduct } from '../../../features/products';
import { MediaUploadError } from '../../../services/mediaUpload';
import KeyboardAvoider from '../../../components/native/KeyboardAvoider';
import ModalHeader from '../../../components/native/ModalHeader';
import ProductForm from '../../../components/native/ProductForm';
import { EmptyState } from '../../../components/native/ui';
import {
  canManageProduct,
  PRODUCT_PHOTO_FAILED,
  PRODUCT_SAVE_FAILED,
  productDraftChanged,
  productDraftFrom,
  productDraftValid,
  productEditsFrom,
  type ProductDraft,
} from '../../../lib/screens/products';
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
  const { addToast } = useApp();
  const { profileId, authUserId } = useCurrentProfile();
  const { data: product, isPending } = useProductQuery(productId);
  const updateProduct = useUpdateProduct(authUserId);
  const [draft, setDraft] = useState<ProductDraft | null>(null);

  // Start the form from the product once it has loaded, and only then: a
  // refetch while editing must not wipe what the owner has typed.
  useEffect(() => {
    if (product && draft === null) setDraft(productDraftFrom(product));
  }, [product, draft]);

  const close = () => router.back();

  if (isPending || (product && !draft)) {
    return (
      <SafeAreaView style={styles.screen}>
        <ModalHeader title="Edit product" onCancel={close} onSave={() => undefined} canSave={false} />
        <ActivityIndicator style={styles.loading} color={color.textMuted} accessibilityLabel="Loading" />
      </SafeAreaView>
    );
  }

  if (!product || !draft || !canManageProduct(profileId, product)) {
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

  const canSave = productDraftValid(draft) && productDraftChanged(draft, product) && !updateProduct.isPending;

  const handleSave = () => {
    if (!canSave) return;
    updateProduct.mutate(
      { product, edits: productEditsFrom(draft, product) },
      {
        onSuccess: () => {
          addToast('Saved.', 'success');
          close();
        },
        onError: (error) =>
          addToast(error instanceof MediaUploadError ? PRODUCT_PHOTO_FAILED : PRODUCT_SAVE_FAILED, 'error'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ModalHeader
        title="Edit product"
        onCancel={close}
        onSave={handleSave}
        canSave={canSave}
        saving={updateProduct.isPending}
      />
      <KeyboardAvoider style={styles.fill}>
        <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          <ProductForm draft={draft} onChange={setDraft} />
        </ScrollView>
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
