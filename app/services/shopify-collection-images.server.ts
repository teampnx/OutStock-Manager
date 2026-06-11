type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const COLLECTION_IMAGES_QUERY = `#graphql
  query OutStockCollectionImages($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Collection {
        id
        image {
          url
          altText
        }
      }
    }
  }
`;

export type CollectionImageSnapshot = {
  url: string;
  altText: string | null;
};

const BATCH_SIZE = 250;

export async function fetchCollectionImagesFromShopify(
  admin: AdminGraphql,
  shopifyCollectionIds: string[],
): Promise<Map<string, CollectionImageSnapshot>> {
  const images = new Map<string, CollectionImageSnapshot>();
  const uniqueIds = [...new Set(shopifyCollectionIds)];

  for (let index = 0; index < uniqueIds.length; index += BATCH_SIZE) {
    const batch = uniqueIds.slice(index, index + BATCH_SIZE);
    const response = await admin.graphql(COLLECTION_IMAGES_QUERY, {
      variables: { ids: batch },
    });
    const json = await response.json();

    if (json.errors?.length) {
      console.warn(
        `[collection-images] Shopify batch failed: ${json.errors[0]?.message}`,
      );
      continue;
    }

    for (const node of json.data?.nodes ?? []) {
      if (!node?.id || !node.image?.url) {
        continue;
      }

      images.set(node.id, {
        url: node.image.url,
        altText: node.image.altText ?? null,
      });
    }
  }

  return images;
}
