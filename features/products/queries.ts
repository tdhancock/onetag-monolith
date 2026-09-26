// Read hooks for Products (ONE-40).

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchBusinessProducts, fetchProduct, searchProducts } from './api';
import { productKeys } from './keys';
import type { Product, ProductSearchResult, ProductSummary } from './types';

/**
 * One product with everything its page shows. `data` is null when there is
 * no such product — deleted, or never there. Needs no session.
 */
export const useProductQuery = (productId: string | undefined) =>
  useQuery<Product | null>({
    queryKey: productKeys.detail(productId ?? ''),
    queryFn: () => fetchProduct(productId!),
    enabled: Boolean(productId),
  });

/** Every product a business lists, newest first. */
export const useBusinessProductsQuery = (businessProfileId: string | undefined) =>
  useQuery<ProductSummary[]>({
    queryKey: productKeys.business(businessProfileId ?? ''),
    queryFn: () => fetchBusinessProducts(businessProfileId!),
    enabled: Boolean(businessProfileId),
  });

/**
 * Products by name from every business, for a project's picker (ONE-41). The
 * last results stay up while the next search runs, so the list does not
 * blank on every keystroke.
 */
export const useProductSearchQuery = (query: string) =>
  useQuery<ProductSearchResult[]>({
    queryKey: productKeys.search(query.trim()),
    queryFn: () => searchProducts(query),
    placeholderData: keepPreviousData,
  });
