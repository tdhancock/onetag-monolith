// Read hooks for Products (ONE-40).

import { useQuery } from '@tanstack/react-query';
import { fetchBusinessProducts, fetchProduct, fetchProductProjects } from './api';
import { productKeys } from './keys';
import type { Product, ProductProject, ProductSummary } from './types';

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

/** The Projects that Link a product — the way onward from its page. */
export const useProductProjectsQuery = (productId: string | undefined) =>
  useQuery<ProductProject[]>({
    queryKey: productKeys.projects(productId ?? ''),
    queryFn: () => fetchProductProjects(productId!),
    enabled: Boolean(productId),
  });
