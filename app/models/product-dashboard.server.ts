import type { ActivityType, InventoryStatus } from "@prisma/client";

import { formatActivityTypeLabel } from "../lib/activity-format";
import prisma from "../db.server";
import { fetchProductImagesFromShopify } from "../services/shopify-product-images.server";
import { getDashboardStats } from "./activity-log.server";
import { ensureShop } from "./shop.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const REORDER_TYPES: ActivityType[] = ["PUSH_SOLD_OUT"];
const RESTORE_TYPES: ActivityType[] = ["RESTORE_ORIGINAL", "RESTORE_TOP"];

export type ProductCollectionPosition = {
  collectionId: string;
  collectionTitle: string;
  originalPosition: number;
  currentPosition: number;
};

export type ProductLastAction = {
  label: string;
  occurredAt: string;
  collectionTitle: string | null;
  oldPosition: number | null;
  newPosition: number | null;
};

export type ProductDashboardItem = {
  id: string;
  shopifyProductId: string;
  title: string;
  imageUrl: string | null;
  imageAlt: string | null;
  totalAvailable: number;
  inventoryPolicy: string;
  status: InventoryStatus;
  isSoldOut: boolean;
  collections: ProductCollectionPosition[];
  lastInventoryChangeAt: string | null;
  lastReorderAction: ProductLastAction | null;
  lastRestoreAction: ProductLastAction | null;
};

export type ProductDashboardSummary = {
  totalTrackedProducts: number;
  inStockProducts: number;
  soldOutProducts: number;
  productsMoved: number;
  productsRestored: number;
};

export type ProductDashboardData = {
  products: ProductDashboardItem[];
  summary: ProductDashboardSummary;
};

function trackedProductToInventoryStatus(product: {
  tracksInventory: boolean;
  isSoldOut: boolean;
}): InventoryStatus {
  if (!product.tracksInventory) {
    return "UNKNOWN";
  }
  return product.isSoldOut ? "SOLD_OUT" : "IN_STOCK";
}

function formatProductTitle(
  title: string | null,
  shopifyProductId: string,
): string {
  if (title) {
    return title;
  }
  const parts = shopifyProductId.split("/");
  return `Product ${parts[parts.length - 1] ?? shopifyProductId}`;
}

function activityLogToLastAction(log: {
  type: ActivityType;
  createdAt: Date;
  collectionTitle: string | null;
  oldPosition: number | null;
  newPosition: number | null;
}): ProductLastAction {
  return {
    label: formatActivityTypeLabel(log.type),
    occurredAt: log.createdAt.toISOString(),
    collectionTitle: log.collectionTitle,
    oldPosition: log.oldPosition,
    newPosition: log.newPosition,
  };
}

function buildLatestActionMaps(
  logs: Array<{
    trackedProductId: string | null;
    type: ActivityType;
    createdAt: Date;
    collectionTitle: string | null;
    oldPosition: number | null;
    newPosition: number | null;
  }>,
): {
  lastReorderByProduct: Map<string, ProductLastAction>;
  lastRestoreByProduct: Map<string, ProductLastAction>;
} {
  const lastReorderByProduct = new Map<string, ProductLastAction>();
  const lastRestoreByProduct = new Map<string, ProductLastAction>();

  for (const log of logs) {
    if (!log.trackedProductId) {
      continue;
    }

    if (
      REORDER_TYPES.includes(log.type) &&
      !lastReorderByProduct.has(log.trackedProductId)
    ) {
      lastReorderByProduct.set(
        log.trackedProductId,
        activityLogToLastAction(log),
      );
      continue;
    }

    if (
      RESTORE_TYPES.includes(log.type) &&
      !lastRestoreByProduct.has(log.trackedProductId)
    ) {
      lastRestoreByProduct.set(
        log.trackedProductId,
        activityLogToLastAction(log),
      );
    }
  }

  return { lastReorderByProduct, lastRestoreByProduct };
}

export async function listProductDashboardForShop(
  shopDomain: string,
  admin: AdminGraphql,
): Promise<ProductDashboardData> {
  const shop = await ensureShop(shopDomain);

  const [products, activityLogs, stats] = await Promise.all([
    prisma.trackedProduct.findMany({
      where: { shopId: shop.id },
      include: {
        collectionProductPositions: {
          include: {
            collection: {
              select: { title: true },
            },
          },
          orderBy: { collection: { title: "asc" } },
        },
      },
      orderBy: [{ lastStatusChangeAt: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.activityLog?.findMany
      ? prisma.activityLog.findMany({
          where: {
            shopId: shop.id,
            trackedProductId: { not: null },
            type: { in: [...REORDER_TYPES, ...RESTORE_TYPES] },
          },
          orderBy: { createdAt: "desc" },
          select: {
            trackedProductId: true,
            type: true,
            createdAt: true,
            collectionTitle: true,
            oldPosition: true,
            newPosition: true,
          },
        })
      : Promise.resolve([]),
    getDashboardStats(shopDomain, shop.id),
  ]);

  const { lastReorderByProduct, lastRestoreByProduct } =
    buildLatestActionMaps(activityLogs);

  let imageByProductId = new Map<string, { url: string; altText: string | null }>();
  try {
    imageByProductId = await fetchProductImagesFromShopify(
      admin,
      products.map((product) => product.shopifyProductId),
    );
  } catch (error) {
    console.warn(
      `[product-dashboard] Could not load product images for ${shopDomain}:`,
      error,
    );
  }

  const dashboardProducts: ProductDashboardItem[] = products.map((product) => {
    const image = imageByProductId.get(product.shopifyProductId);

    return {
      id: product.id,
      shopifyProductId: product.shopifyProductId,
      title: formatProductTitle(product.title, product.shopifyProductId),
      imageUrl: image?.url ?? null,
      imageAlt: image?.altText ?? product.title,
      totalAvailable: product.totalAvailable,
      inventoryPolicy: product.inventoryPolicy,
      status: trackedProductToInventoryStatus(product),
      isSoldOut: product.isSoldOut,
      collections: product.collectionProductPositions.map((position) => ({
        collectionId: position.collectionId,
        collectionTitle: position.collection.title,
        originalPosition: position.originalPosition,
        currentPosition: position.currentPosition,
      })),
      lastInventoryChangeAt:
        product.lastStatusChangeAt?.toISOString() ?? null,
      lastReorderAction: lastReorderByProduct.get(product.id) ?? null,
      lastRestoreAction: lastRestoreByProduct.get(product.id) ?? null,
    };
  });

  return {
    products: dashboardProducts,
    summary: {
      totalTrackedProducts: stats.totalTrackedProducts,
      inStockProducts: stats.inStockProducts,
      soldOutProducts: stats.soldOutProducts,
      productsMoved: stats.productsMovedToBottom,
      productsRestored: stats.productsRestored,
    },
  };
}
