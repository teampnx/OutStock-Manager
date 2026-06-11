type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const PRODUCT_IMAGES_QUERY = `#graphql
  query OutStockProductImages($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        featuredImage {
          url
          altText
        }
      }
    }
  }
`;

export type ProductImageSnapshot = {
  url: string;
  altText: string | null;
};

const BATCH_SIZE = 250;

export async function fetchProductImagesFromShopify(
  admin: AdminGraphql,
  shopifyProductIds: string[],
): Promise<Map<string, ProductImageSnapshot>> {
  const images = new Map<string, ProductImageSnapshot>();
  const uniqueIds = [...new Set(shopifyProductIds)];

  for (let index = 0; index < uniqueIds.length; index += BATCH_SIZE) {
    const batch = uniqueIds.slice(index, index + BATCH_SIZE);
    const response = await admin.graphql(PRODUCT_IMAGES_QUERY, {
      variables: { ids: batch },
    });
    const json = await response.json();

    if (json.errors?.length) {
      console.warn(
        `[product-images] Shopify batch failed: ${json.errors[0]?.message}`,
      );
      continue;
    }

    for (const node of json.data?.nodes ?? []) {
      if (!node?.id || !node.featuredImage?.url) {
        continue;
      }

      images.set(node.id, {
        url: node.featuredImage.url,
        altText: node.featuredImage.altText ?? null,
      });
    }
  }

  return images;
}
