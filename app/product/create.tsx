import React from 'react';
import { StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from '@tanstack/react-form';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { useCreateProduct } from '../../features/products';
import { MediaUploadError } from '../../services/mediaUpload';
import KeyboardAvoider from '../../components/native/KeyboardAvoider';
import FormScrollView from '../../components/native/FormScrollView';
import ModalHeader from '../../components/native/ModalHeader';
import ProductForm, { productFormOptions } from '../../components/native/ProductForm';
import { useAppForm } from '../../components/native/form';
import { EmptyState } from '../../components/native/ui';
import {
  canCreateProduct,
  newProductInputFrom,
  PRODUCT_PHOTO_FAILED,
  PRODUCT_SAVE_FAILED,
  productRoute,
} from '../../lib/screens/products';
import { color, space } from '../../theme/tokens';

/**
 * Add a product (ONE-40), as the active business profile. A modal, declared
 * in app/_layout.tsx.
 *
 * Only a business profile lists products, and only a business profile is
 * offered the way here; anyone who arrives some other way is told so rather
 * than handed a form the database would refuse.
 */
export default function CreateProductScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const { profile, profileId, authUserId } = useCurrentProfile();
  const createProduct = useCreateProduct(authUserId);
  const form = useAppForm({
    ...productFormOptions,
    onSubmit: ({ value }) => {
      if (!profileId) return;
      createProduct.mutate(newProductInputFrom(value, profileId), {
        onSuccess: (productId) => {
          addToast('Product added.', 'success');
          router.replace(productRoute(productId));
        },
        onError: (error) => addToast(error instanceof MediaUploadError ? PRODUCT_PHOTO_FAILED : PRODUCT_SAVE_FAILED, 'error'),
      });
    },
  });
  const valid = useStore(form.store, (state) => state.canSubmit);

  const canSave = valid && Boolean(profileId) && !createProduct.isPending;
  const handleSave = () => {
    if (canSave) void form.handleSubmit();
  };

  if (!canCreateProduct(profile)) {
    return (
      <SafeAreaView style={styles.screen}>
        <ModalHeader title="New product" onCancel={() => router.back()} onSave={() => undefined} canSave={false} />
        <EmptyState
          title="Products belong to business profiles"
          body="Switch to your business profile to list a product."
          action={{ label: 'Back', onPress: () => router.back() }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ModalHeader
        title="New product"
        onCancel={() => router.back()}
        onSave={handleSave}
        canSave={canSave}
        saving={createProduct.isPending}
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
  scroll: {
    paddingBottom: space.xxl,
  },
});
