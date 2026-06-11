import type {
  ActivityType,
  InventoryStatus,
  Prisma,
  TriggerSource,
} from "@prisma/client";

import {
  activityTypeToCategory,
  activityTypeToTone,
  formatActivityTypeLabel,
  formatInventoryChangeDescription,
  formatInventoryChangeTitle,
  formatPositionChange,
  type ActivityFeedItem,
} from "../lib/activity-format";
import prisma from "../db.server";
import { ensureShop } from "./shop.server";

export type RecordActivityLogInput = {
  shopDomain: string;
  type: ActivityType;
  trackedProductId?: string | null;
  collectionId?: string | null;
  productTitle?: string | null;
  collectionTitle?: string | null;
  oldPosition?: number | null;
  newPosition?: number | null;
  detail?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export type DashboardStats = {
  totalTrackedProducts: number;
  totalTrackedCollections: number;
  inStockProducts: number;
  soldOutProducts: number;
  productsMovedToBottom: number;
  productsRestored: number;
  lastSuccessfulSync: string | null;
};

const FEED_FETCH_LIMIT = 100;

export async function recordActivityLog(
  input: RecordActivityLogInput,
): Promise<void> {
  const shop = await ensureShop(input.shopDomain);

  await prisma.activityLog.create({
    data: {
      shopId: shop.id,
      type: input.type,
      trackedProductId: input.trackedProductId ?? null,
      collectionId: input.collectionId ?? null,
      productTitle: input.productTitle ?? null,
      collectionTitle: input.collectionTitle ?? null,
      oldPosition: input.oldPosition ?? null,
      newPosition: input.newPosition ?? null,
      detail: input.detail ?? null,
      metadata: input.metadata ?? undefined,
    },
  });
}

function activityLogToFeedItem(log: {
  id: string;
  type: ActivityType;
  productTitle: string | null;
  collectionTitle: string | null;
  oldPosition: number | null;
  newPosition: number | null;
  detail: string | null;
  createdAt: Date;
}): ActivityFeedItem {
  const positionText = formatPositionChange(log.oldPosition, log.newPosition);
  const collectionLabel = log.collectionTitle ?? "collection";
  const productLabel = log.productTitle ?? "Product";

  let description = "";
  switch (log.type) {
    case "PUSH_SOLD_OUT":
      description = `${productLabel} in ${collectionLabel} · ${positionText}`;
      break;
    case "RESTORE_ORIGINAL":
    case "RESTORE_TOP":
      description = `${productLabel} in ${collectionLabel} · ${positionText}`;
      break;
    case "REORDER_SKIPPED":
      description = `${productLabel} in ${collectionLabel}${log.detail ? ` · ${log.detail}` : ""}`;
      break;
    case "COLLECTION_SYNCED":
      description = log.detail ?? `${collectionLabel} synced`;
      break;
    case "COLLECTION_DELETED":
      description = log.detail ?? `${collectionLabel} removed from tracking`;
      break;
    case "BACKFILL_SOLD_OUT_COMPLETED":
    case "BACKFILL_COLLECTIONS_COMPLETED":
      description = log.detail ?? formatActivityTypeLabel(log.type);
      break;
    default:
      description = log.detail ?? formatActivityTypeLabel(log.type);
  }

  return {
    id: `log:${log.id}`,
    category: activityTypeToCategory(log.type),
    title: formatActivityTypeLabel(log.type),
    description,
    occurredAt: log.createdAt.toISOString(),
    tone: activityTypeToTone(log.type),
  };
}

function inventoryHistoryToFeedItem(history: {
  id: string;
  previousStatus: InventoryStatus;
  newStatus: InventoryStatus;
  totalAvailable: number;
  triggerSource: TriggerSource;
  createdAt: Date;
  trackedProduct: {
    title: string | null;
    shopifyProductId: string;
  };
}): ActivityFeedItem {
  const title = formatInventoryChangeTitle(
    history.trackedProduct.title,
    history.trackedProduct.shopifyProductId,
  );

  return {
    id: `history:${history.id}`,
    category: "inventory",
    title: "Inventory status changed",
    description: formatInventoryChangeDescription(
      history.previousStatus,
      history.newStatus,
      history.totalAvailable,
      history.triggerSource,
    ),
    occurredAt: history.createdAt.toISOString(),
    tone:
      history.newStatus === "SOLD_OUT"
        ? "warning"
        : history.newStatus === "IN_STOCK"
          ? "success"
          : "info",
  };
}

export async function listActivityFeedForShop(
  shopDomain: string,
  limit = FEED_FETCH_LIMIT,
): Promise<ActivityFeedItem[]> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return [];
  }

  const activityLogClient = prisma.activityLog;
  const [activityLogs, inventoryHistory] = await Promise.all([
    activityLogClient?.findMany
      ? activityLogClient.findMany({
          where: { shopId: shop.id },
          orderBy: { createdAt: "desc" },
          take: limit,
        })
      : Promise.resolve([]),
    prisma.inventoryStatusHistory.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        trackedProduct: {
          select: { title: true, shopifyProductId: true },
        },
      },
    }),
  ]);

  const feed = [
    ...activityLogs.map(activityLogToFeedItem),
    ...inventoryHistory.map(inventoryHistoryToFeedItem),
  ];

  feed.sort(
    (left, right) =>
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
  );

  return feed.slice(0, limit);
}

const EMPTY_DASHBOARD_STATS: DashboardStats = {
  totalTrackedProducts: 0,
  totalTrackedCollections: 0,
  inStockProducts: 0,
  soldOutProducts: 0,
  productsMovedToBottom: 0,
  productsRestored: 0,
  lastSuccessfulSync: null,
};

function jobScope(shopDomain: string) {
  return { shopDomain };
}

export async function getDashboardStats(
  shopDomain: string,
  shopId?: string,
): Promise<DashboardStats> {
  const shop =
    shopId != null
      ? { id: shopId }
      : await prisma.shop.findUnique({
          where: { shopDomain },
          select: { id: true },
        });

  if (!shop) {
    return EMPTY_DASHBOARD_STATS;
  }

  const activityLogClient = prisma.activityLog;
  const activityLogAvailable = Boolean(activityLogClient?.count);

  const [
    totalTrackedProducts,
    totalTrackedCollections,
    inStockProducts,
    soldOutProducts,
    activityMovedCount,
    activityRestoredCount,
    jobMovedCount,
    jobRestoredCount,
    lastCollectionSync,
    lastMembershipJob,
  ] = await Promise.all([
    prisma.trackedProduct.count({ where: { shopId: shop.id } }),
    prisma.collection.count({ where: { shopId: shop.id } }),
    prisma.trackedProduct.count({
      where: { shopId: shop.id, isSoldOut: false, tracksInventory: true },
    }),
    prisma.trackedProduct.count({
      where: { shopId: shop.id, isSoldOut: true },
    }),
    activityLogAvailable
      ? activityLogClient.count({
          where: { shopId: shop.id, type: "PUSH_SOLD_OUT" },
        })
      : Promise.resolve(0),
    activityLogAvailable
      ? activityLogClient.count({
          where: {
            shopId: shop.id,
            type: { in: ["RESTORE_ORIGINAL", "RESTORE_TOP"] },
          },
        })
      : Promise.resolve(0),
    prisma.job.count({
      where: {
        ...jobScope(shopDomain),
        type: "REORDER_SOLD_OUT_PRODUCT",
        status: "COMPLETED",
      },
    }),
    prisma.job.count({
      where: {
        ...jobScope(shopDomain),
        type: "RESTORE_PRODUCT_POSITION",
        status: "COMPLETED",
      },
    }),
    prisma.collection.aggregate({
      where: { shopId: shop.id },
      _max: { lastSyncedAt: true },
    }),
    prisma.job.findFirst({
      where: {
        ...jobScope(shopDomain),
        type: "SYNC_COLLECTION_MEMBERSHIP",
        status: "COMPLETED",
      },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  const lastSyncCandidates = [
    lastCollectionSync._max.lastSyncedAt,
    lastMembershipJob?.updatedAt ?? null,
  ].filter((value): value is Date => value != null);

  const lastSuccessfulSync =
    lastSyncCandidates.length > 0
      ? new Date(
          Math.max(...lastSyncCandidates.map((value) => value.getTime())),
        ).toISOString()
      : null;

  return {
    totalTrackedProducts,
    totalTrackedCollections,
    inStockProducts,
    soldOutProducts,
    productsMovedToBottom: Math.max(activityMovedCount, jobMovedCount),
    productsRestored: Math.max(activityRestoredCount, jobRestoredCount),
    lastSuccessfulSync,
  };
}
