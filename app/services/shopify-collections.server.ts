const ALL_COLLECTIONS_QUERY = `#graphql
  query OutStockAllCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      nodes {
        id
        title
        sortOrder
        productsCount {
          count
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const COLLECTION_BY_ID_QUERY = `#graphql
  query OutStockCollectionById($id: ID!) {
    collection(id: $id) {
      id
      title
      sortOrder
      productsCount {
        count
      }
    }
  }
`;

const COLLECTION_UPDATE_MUTATION = `#graphql
  mutation OutStockCollectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        sortOrder
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_REORDER_PRODUCTS_MUTATION = `#graphql
  mutation OutStockCollectionReorderProducts($id: ID!, $moves: [MoveInput!]!) {
    collectionReorderProducts(id: $id, moves: $moves) {
      job {
        id
        done
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const SHOPIFY_JOB_STATUS_QUERY = `#graphql
  query OutStockShopifyJobStatus($id: ID!) {
    job(id: $id) {
      id
      done
    }
  }
`;

const COLLECTION_PRODUCTS_QUERY = `#graphql
  query OutStockCollectionProducts($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      id
      products(first: $first, after: $after) {
        nodes {
          id
          title
          featuredImage {
            url
            altText
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ShopifyCollectionSnapshot = {
  shopifyCollectionId: string;
  title: string;
  productsCount: number;
  sortOrder: string;
};

export type CollectionProductMove = {
  productId: string;
  newPosition: number;
};

export type ShopifyCollectionProductNode = {
  id: string;
  title: string;
  featuredImage?: {
    url: string;
    altText: string | null;
  } | null;
};

export function toCollectionGid(collectionId: string | number): string {
  const value = String(collectionId);
  if (value.startsWith("gid://")) {
    return value;
  }
  return `gid://shopify/Collection/${value}`;
}

export async function fetchAllCollectionsFromShopify(
  admin: AdminGraphql,
): Promise<ShopifyCollectionSnapshot[]> {
  const collections: ShopifyCollectionSnapshot[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(ALL_COLLECTIONS_QUERY, {
      variables: { first: 250, after },
    });
    const json = await response.json();

    if (json.errors?.length) {
      throw new Error(json.errors[0]?.message ?? "Failed to fetch collections");
    }

    const connection = json.data?.collections;
    if (!connection) {
      break;
    }

    for (const node of connection.nodes as Array<{
      id: string;
      title: string;
      sortOrder?: string;
      productsCount?: { count: number };
    }>) {
      collections.push({
        shopifyCollectionId: node.id,
        title: node.title,
        productsCount: node.productsCount?.count ?? 0,
        sortOrder: node.sortOrder ?? "MANUAL",
      });
    }

    hasNextPage = connection.pageInfo?.hasNextPage ?? false;
    after = connection.pageInfo?.endCursor ?? null;
  }

  return collections;
}

export async function updateCollectionSortOrderOnShopify(
  admin: AdminGraphql,
  shopifyCollectionId: string,
  sortOrder: string,
): Promise<string> {
  const response = await admin.graphql(COLLECTION_UPDATE_MUTATION, {
    variables: {
      input: {
        id: toCollectionGid(shopifyCollectionId),
        sortOrder,
      },
    },
  });
  const json = await response.json();

  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? "collectionUpdate failed");
  }

  const payload = json.data?.collectionUpdate;
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(userErrors[0]?.message ?? "collectionUpdate failed");
  }

  const updatedSortOrder = payload?.collection?.sortOrder;
  if (!updatedSortOrder) {
    throw new Error("collectionUpdate did not return an updated collection");
  }

  return updatedSortOrder;
}

export async function fetchCollectionFromShopify(
  admin: AdminGraphql,
  shopifyCollectionId: string,
): Promise<ShopifyCollectionSnapshot | null> {
  const response = await admin.graphql(COLLECTION_BY_ID_QUERY, {
    variables: { id: toCollectionGid(shopifyCollectionId) },
  });
  const json = await response.json();

  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? "Failed to fetch collection");
  }

  const collection = json.data?.collection;
  if (!collection) {
    return null;
  }

  return {
    shopifyCollectionId: collection.id,
    title: collection.title,
    productsCount: collection.productsCount?.count ?? 0,
    sortOrder: collection.sortOrder ?? "MANUAL",
  };
}

export async function collectionReorderProducts(
  admin: AdminGraphql,
  shopifyCollectionId: string,
  moves: CollectionProductMove[],
): Promise<string> {
  const response = await admin.graphql(COLLECTION_REORDER_PRODUCTS_MUTATION, {
    variables: {
      id: toCollectionGid(shopifyCollectionId),
      moves: moves.map((move) => ({
        id: move.productId.startsWith("gid://")
          ? move.productId
          : `gid://shopify/Product/${move.productId}`,
        newPosition: String(move.newPosition),
      })),
    },
  });
  const json = await response.json();

  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? "collectionReorderProducts failed");
  }

  const payload = json.data?.collectionReorderProducts;
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(userErrors[0]?.message ?? "collectionReorderProducts failed");
  }

  const jobId = payload?.job?.id;
  if (!jobId) {
    throw new Error("collectionReorderProducts did not return a job id");
  }

  return jobId;
}

const JOB_POLL_INTERVAL_MS = 1_000;
const JOB_POLL_MAX_ATTEMPTS = 60;

export async function pollShopifyJobUntilDone(
  admin: AdminGraphql,
  jobId: string,
): Promise<void> {
  for (let attempt = 0; attempt < JOB_POLL_MAX_ATTEMPTS; attempt++) {
    const response = await admin.graphql(SHOPIFY_JOB_STATUS_QUERY, {
      variables: { id: jobId },
    });
    const json = await response.json();

    if (json.errors?.length) {
      throw new Error(json.errors[0]?.message ?? "Failed to poll Shopify job");
    }

    if (json.data?.job?.done) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }

  throw new Error(`Shopify job ${jobId} did not complete in time`);
}

export async function fetchCollectionProductsFromShopify(
  admin: AdminGraphql,
  shopifyCollectionId: string,
): Promise<ShopifyCollectionProductNode[]> {
  const products: ShopifyCollectionProductNode[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(COLLECTION_PRODUCTS_QUERY, {
      variables: {
        id: toCollectionGid(shopifyCollectionId),
        first: 250,
        after,
      },
    });
    const json = await response.json();

    if (json.errors?.length) {
      throw new Error(
        json.errors[0]?.message ?? "Failed to fetch collection products",
      );
    }

    const connection = json.data?.collection?.products;
    if (!connection) {
      break;
    }

    for (const node of connection.nodes as ShopifyCollectionProductNode[]) {
      products.push(node);
    }

    hasNextPage = connection.pageInfo?.hasNextPage ?? false;
    after = connection.pageInfo?.endCursor ?? null;
  }

  return products;
}
