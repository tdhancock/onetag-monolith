// The public surface of the products domain (ONE-40).
//
// Screens and other features import from `features/products`, never from a
// file inside it. See features/README.md.

export {
  fetchProduct,
  fetchBusinessProducts,
  fetchProductProjects,
  createProduct,
  updateProduct,
  saveProductEdits,
  saveProductMedia,
  saveProductSpecs,
  deleteProduct,
  mapProductRow,
  mapProductSummaryRow,
  representativeImage,
  mediaChanges,
  specChanges,
  PRODUCT_SELECT,
  PRODUCT_SUMMARY_SELECT,
} from './api';
export type { NewProductInput, ProductEdits, SpecEdit, MediaChanges, SpecChanges } from './api';
export { productKeys } from './keys';
export { useProductQuery, useBusinessProductsQuery, useProductProjectsQuery } from './queries';
export { useCreateProduct, useUpdateProduct, useSetProductAvailable, useDeleteProduct } from './mutations';
export type { UpdateProductInput, ProductAvailabilityInput } from './mutations';
export type {
  Product,
  ProductMedia,
  ProductSpec,
  ProductBusiness,
  ProductSummary,
  ProductProject,
  ProductFields,
  SpecInput,
  ProductRow,
  ProductSummaryRow,
} from './types';
