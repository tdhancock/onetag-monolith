// The public surface of the products domain (ONE-40).
//
// Screens and other features import from `features/products`, never from a
// file inside it. See features/README.md.

export {
  fetchProduct,
  fetchBusinessProducts,
  searchProducts,
  PRODUCT_SEARCH_LIMIT,
  createProduct,
  updateProduct,
  saveProductEdits,
  saveProductMedia,
  saveProductSpecs,
  deleteProduct,
  mapProductRow,
  mediaChanges,
  specChanges,
  PRODUCT_SELECT,
} from './api';
// A product as a list shows it, shared with other features through services/.
export { mapProductSummaryRow, representativeImage, PRODUCT_SUMMARY_SELECT } from '../../services/productRows';
export type { NewProductInput, ProductEdits, SpecEdit, MediaChanges, SpecChanges } from './api';
export { productKeys } from './keys';
export { useProductQuery, useBusinessProductsQuery, useProductSearchQuery } from './queries';
export { useCreateProduct, useUpdateProduct, useSetProductAvailable, useDeleteProduct } from './mutations';
export type { UpdateProductInput, ProductAvailabilityInput } from './mutations';
export type {
  Product,
  ProductMedia,
  ProductSpec,
  ProductBusiness,
  ProductSummary,
  ProductSearchResult,
  ProductFields,
  SpecInput,
  ProductRow,
  ProductSummaryRow,
} from './types';
