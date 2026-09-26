// Write hooks for Products (ONE-40).
//
// None is optimistic: creating, editing and deleting a product happen on a
// form or behind a confirmation, where waiting for the server is expected and
// a rollback would only show the owner something that never happened.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createProduct,
  deleteProduct,
  saveProductEdits,
  updateProduct,
  type NewProductInput,
  type ProductEdits,
} from './api';
import { productKeys } from './keys';
import { projectKeys } from '../projects';
import { saveKeys } from '../saves';
import type { Product } from './types';
import type { AuthUserId } from '../../types';

const signedIn = (authUserId: AuthUserId | undefined): AuthUserId => {
  if (!authUserId) throw new Error('You must be signed in to change a product.');
  return authUserId;
};

/**
 * Create a product as the active business profile, with its images and
 * specs. Resolves to the new product's id. Images are filed under the
 * account, so this takes the account's id as well as the profile's.
 */
export const useCreateProduct = (authUserId: AuthUserId | undefined) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewProductInput) => createProduct(signedIn(authUserId), input),
    onSuccess: (_productId, input) =>
      queryClient.invalidateQueries({ queryKey: productKeys.business(input.businessProfileId) }),
  });
};

export interface UpdateProductInput {
  /** The product as it is stored, which the edit is measured against. */
  product: Product;
  edits: ProductEdits;
}

/**
 * Save an edit to a product: its fields, its images in their new order and
 * its specs in theirs. Re-reads the product whether or not it all went
 * through, so a partial failure shows what was actually saved.
 */
export const useUpdateProduct = (authUserId: AuthUserId | undefined) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ product, edits }: UpdateProductInput) => saveProductEdits(signedIn(authUserId), product, edits),
    onSettled: (_data, _error, { product }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: productKeys.detail(product.id) }),
        queryClient.invalidateQueries({ queryKey: productKeys.business(product.businessProfileId) }),
      ]),
  });
};

export interface ProductAvailabilityInput {
  product: Pick<Product, 'id' | 'businessProfileId'>;
  available: boolean;
}

/**
 * Take a product down without deleting it, or put it back: the softer
 * alternative to deletion, which keeps its tags, saves and project links.
 */
export const useSetProductAvailable = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ product, available }: ProductAvailabilityInput) => updateProduct(product.id, { available }),
    onSettled: (_data, _error, { product }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: productKeys.detail(product.id) }),
        queryClient.invalidateQueries({ queryKey: productKeys.business(product.businessProfileId) }),
      ]),
  });
};

/**
 * Delete a product, for good. Its cached page reads as gone at once; its
 * business's list, every profile's saves and every project's products are
 * re-read, since its saves and project links went with it.
 */
export const useDeleteProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (product: Pick<Product, 'id' | 'businessProfileId'>) => deleteProduct(product.id),
    onSuccess: (_data, product) => {
      queryClient.setQueryData(productKeys.detail(product.id), null);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: productKeys.business(product.businessProfileId) }),
        queryClient.invalidateQueries({ queryKey: saveKeys.all }),
        queryClient.invalidateQueries({ queryKey: projectKeys.all }),
      ]);
    },
  });
};
