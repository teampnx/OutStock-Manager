import type { InventoryPolicy, ProductStatus } from "@prisma/client";

import type { ProductInventoryInput } from "./sold-out-detector.server";

const PRODUCT_INVENTORY_QUERY = `#graphql
  query OutStockProductInventory($id: ID!) {
    product(id: $id) {
      id
      title
      status
      totalInventory
      variants(first: 100) {
        nodes {
          inventoryPolicy
          inventoryQuantity
          inventoryItem {
            tracked
          }
        }
      }
    }
  }
`;

const INVENTORY_ITEM_PRODUCT_QUERY = `#graphql
  query OutStockInventoryItemProduct($id: ID!) {
    inventoryItem(id: $id) {
      id
      variant {
        product {
          id
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

type ShopifyProductNode = {
  id: string;
  title: string;
  status: string;
  totalInventory: number;
  variants: {
    nodes: Array<{
      inventoryPolicy: string;
      inventoryQuantity: number | null;
      inventoryItem: { tracked: boolean } | null;
    }>;
  };
};

export type ShopifyProductInventorySnapshot = {
  shopifyProductId: string;
  title: string;
  status: ProductStatus;
  tracksInventory: boolean;
  inventoryPolicy: InventoryPolicy;
  totalAvailable: number;
  inventory: ProductInventoryInput;
};

export function toProductGid(productId: string | number): string {
  const value = String(productId);
  if (value.startsWith("gid://")) {
    return value;
  }
  return `gid://shopify/Product/${value}`;
}

export function toInventoryItemGid(inventoryItemId: string | number): string {
  const value = String(inventoryItemId);
  if (value.startsWith("gid://")) {
    return value;
  }
  return `gid://shopify/InventoryItem/${value}`;
}

function mapProductStatus(status: string): ProductStatus {
  if (status === "DRAFT") return "DRAFT";
  if (status === "ARCHIVED") return "ARCHIVED";
  return "ACTIVE";
}

function mapInventoryPolicy(
  variants: ShopifyProductNode["variants"]["nodes"],
): InventoryPolicy {
  const hasContinue = variants.some(
    (variant) => variant.inventoryPolicy === "CONTINUE",
  );
  return hasContinue ? "CONTINUE" : "DENY";
}

function mapProductInventoryInput(
  product: ShopifyProductNode,
): ProductInventoryInput {
  return {
    status: mapProductStatus(product.status),
    variants: product.variants.nodes.map((variant) => ({
      tracksInventory: variant.inventoryItem?.tracked ?? false,
      inventoryPolicy:
        variant.inventoryPolicy === "CONTINUE" ? "CONTINUE" : "DENY",
      available: variant.inventoryQuantity ?? 0,
    })),
  };
}

export function mapShopifyProductInventory(
  product: ShopifyProductNode,
): ShopifyProductInventorySnapshot {
  const inventory = mapProductInventoryInput(product);
  const tracksInventory = inventory.variants.some(
    (variant) => variant.tracksInventory,
  );

  return {
    shopifyProductId: product.id,
    title: product.title,
    status: mapProductStatus(product.status),
    tracksInventory,
    inventoryPolicy: mapInventoryPolicy(product.variants.nodes),
    totalAvailable: product.totalInventory ?? 0,
    inventory,
  };
}

export async function fetchProductInventorySnapshot(
  admin: AdminGraphql,
  shopifyProductId: string,
): Promise<ShopifyProductInventorySnapshot | null> {
  const response = await admin.graphql(PRODUCT_INVENTORY_QUERY, {
    variables: { id: toProductGid(shopifyProductId) },
  });
  const json = await response.json();

  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? "Failed to fetch product");
  }

  const product = json.data?.product as ShopifyProductNode | null;
  if (!product) {
    return null;
  }

  return mapShopifyProductInventory(product);
}

export async function resolveProductIdFromInventoryItem(
  admin: AdminGraphql,
  inventoryItemId: string | number,
): Promise<string | null> {
  const response = await admin.graphql(INVENTORY_ITEM_PRODUCT_QUERY, {
    variables: { id: toInventoryItemGid(inventoryItemId) },
  });
  const json = await response.json();

  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? "Failed to fetch inventory item");
  }

  return json.data?.inventoryItem?.variant?.product?.id ?? null;
}
