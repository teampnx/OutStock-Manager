export type SortPreviewProduct = {
  productId: string;
  title: string;
  imageUrl: string | null;
  imageAlt: string | null;
  isSoldOut: boolean;
};

export type SortPreviewSections = {
  topProducts: SortPreviewProduct[];
  pushedDownProducts: SortPreviewProduct[];
};

export function buildSortedPreview(
  products: SortPreviewProduct[],
): SortPreviewSections {
  const topProducts: SortPreviewProduct[] = [];
  const pushedDownProducts: SortPreviewProduct[] = [];

  for (const product of products) {
    if (product.isSoldOut) {
      pushedDownProducts.push(product);
    } else {
      topProducts.push(product);
    }
  }

  return { topProducts, pushedDownProducts };
}
