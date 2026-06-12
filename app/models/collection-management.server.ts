import type { ActivityType, CollectionSortOrder } from "@prisma/client";

import { formatActivityTypeLabel } from "../lib/activity-format";
import {
  formatCollectionSortOrderLabel,
  getCollectionSortBlockedReason,
  mapShopifySortOrder,
} from "../lib/collection-sort-order";
import { formatInventoryStatusLabel } from "../lib/inventory-status";
import prisma from "../db.server";
import {
  getCollectionSortStatusMap,
  type CollectionSortStatus,
} from "./collection-sort-status.server";
import { fetchCollectionImagesFromShopify } from "../services/shopify-collection-images.server";
import {
  fetchAllCollectionsFromShopify,
  fetchCollectionFromShopify,
  fetchCollectionProductsFromShopify,
  toCollectionGid,
  updateCollectionSortOrderOnShopify,
} from "../services/shopify-collections.server";
import { assertWithinCollectionLimit } from "../lib/plan-enforcement.server";
import { ensureShop } from "./shop.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const REORDER_ACTIVITY_TYPES: ActivityType[] = [
  "PUSH_SOLD_OUT",
  "RESTORE_ORIGINAL",
  "RESTORE_TOP",
];

export type CollectionManagementItem = {
  id: string;
  shopifyCollectionId: string;
  title: string;
  imageUrl: string | null;
  imageAlt: string | null;
  productCount: number;
  sortOrder: CollectionSortOrder;
  sortOrderLabel: string;
  enabled: boolean;
  isSortable: boolean;
  sortBlockedReason: string | null;
  sortStatus: CollectionSortStatus;
};

export type CollectionSortabilityReport = {
  sortable: string[];
  blocked: Array<{
    title: string;
    sortOrder: CollectionSortOrder;
    reason: string;
  }>;
};

export type CollectionManagementList = {
  collections: CollectionManagementItem[];
  counts: {
    all: number;
    enabled: number;
    disabled: number;
  };
  sortability: CollectionSortabilityReport;
};

export type CollectionProductRow = {
  position: number;
  productId: string;
  title: string;
  imageUrl: string | null;
  imageAlt: string | null;
  inventoryStatus: string;
  isSoldOut: boolean;
  originalPosition: number | null;
  currentPosition: number | null;
};

export type CollectionLastReorderActivity = {
  label: string;
  occurredAt: string;
  productTitle: string | null;
  oldPosition: number | null;
  newPosition: number | null;
  detail: string | null;
};

export type CollectionDetails = {
  id: string;
  shopifyCollectionId: string;
  title: string;
  imageUrl: string | null;
  imageAlt: string | null;
  productCount: number;
  sortOrder: CollectionSortOrder;
  sortOrderLabel: string;
  enabled: boolean;
  isSortable: boolean;
  sortBlockedReason: string | null;
  lastSyncedAt: string | null;
  lastSortedAt: string | null;
  sortStatus: CollectionSortStatus;
  lastReorderActivity: CollectionLastReorderActivity | null;
  products: CollectionProductRow[];
  soldOutCount: number;
};

export type SetCollectionEnabledResult = {
  item: CollectionManagementItem;
  sortBlockedReason: string | null;
};

export class SetCollectionEnabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetCollectionEnabledError";
  }
}

async function ensureManualSortOrderForEnable(
  admin: AdminGraphql,
  shopifyCollectionId: string,
  title: string,
  liveSortOrder: CollectionSortOrder,
): Promise<CollectionSortOrder> {
  if (liveSortOrder === "MANUAL") {
    return "MANUAL";
  }

  console.log(
    `[collection-management] Converting collection=${title} ` +
      `sortOrder=${liveSortOrder} to MANUAL for Push Down enable`,
  );

  try {
    const updatedSortOrder = await updateCollectionSortOrderOnShopify(
      admin,
      shopifyCollectionId,
      "MANUAL",
    );
    return mapShopifySortOrder(updatedSortOrder);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown Shopify API error";
    throw new SetCollectionEnabledError(
      `Could not switch "${title}" to Manual sort in Shopify Admin. ` +
        `Push Down was not enabled. ${detail}`,
    );
  }
}

async function refreshCollectionSortOrdersFromShopify(
  shopId: string,
  admin: AdminGraphql,
): Promise<void> {
  const snapshots = await fetchAllCollectionsFromShopify(admin);
  const syncedAt = new Date();

  await Promise.all(
    snapshots.map((snapshot) =>
      prisma.collection.updateMany({
        where: {
          shopId,
          shopifyCollectionId: snapshot.shopifyCollectionId,
        },
        data: {
          title: snapshot.title,
          sortOrder: mapShopifySortOrder(snapshot.sortOrder),
          lastSyncedAt: syncedAt,
        },
      }),
    ),
  );
}

function buildSortabilityReport(
  items: CollectionManagementItem[],
): CollectionSortabilityReport {
  const sortable: string[] = [];
  const blocked: CollectionSortabilityReport["blocked"] = [];

  for (const item of items) {
    if (!item.enabled) {
      continue;
    }

    if (item.isSortable) {
      sortable.push(item.title);
      continue;
    }

    blocked.push({
      title: item.title,
      sortOrder: item.sortOrder,
      reason:
        item.sortBlockedReason ??
        "Sold-out sorting is not available for this collection.",
    });
  }

  return { sortable, blocked };
}

function toManagementItem(
  collection: {
    id: string;
    shopifyCollectionId: string;
    title: string;
    sortOrder: CollectionSortOrder;
    enabled: boolean;
    _count: { productPositions: number };
  },
  image: { url: string; altText: string | null } | undefined,
  sortStatus: CollectionSortStatus,
): CollectionManagementItem {
  const sortBlockedReason = getCollectionSortBlockedReason(
    collection.enabled,
    collection.sortOrder,
  );

  return {
    id: collection.id,
    shopifyCollectionId: collection.shopifyCollectionId,
    title: collection.title,
    imageUrl: image?.url ?? null,
    imageAlt: image?.altText ?? collection.title,
    productCount: collection._count.productPositions,
    sortOrder: collection.sortOrder,
    sortOrderLabel: formatCollectionSortOrderLabel(collection.sortOrder),
    enabled: collection.enabled,
    isSortable: collection.enabled && collection.sortOrder === "MANUAL",
    sortBlockedReason,
    sortStatus,
  };
}

export async function listCollectionManagementForShop(
  shopDomain: string,
  admin: AdminGraphql,
): Promise<CollectionManagementList> {
  const shop = await ensureShop(shopDomain);

  await refreshCollectionSortOrdersFromShopify(shop.id, admin);

  await prisma.collection.updateMany({
    where: { shopId: shop.id, enabled: true, enabledAt: null },
    data: { enabledAt: new Date() },
  });

  const collections = await prisma.collection.findMany({
    where: { shopId: shop.id },
    include: {
      _count: {
        select: { productPositions: true },
      },
    },
    orderBy: [{ enabled: "desc" }, { title: "asc" }],
  });

  const sortStatusByCollection = await getCollectionSortStatusMap(
    shopDomain,
    collections.map((collection) => ({
      id: collection.id,
      shopifyCollectionId: collection.shopifyCollectionId,
      enabled: collection.enabled,
      lastSortedAt: collection.lastSortedAt,
      enabledAt: collection.enabledAt,
      lastSortAttemptAt: collection.lastSortAttemptAt,
    })),
  );

  let imageByCollectionId = new Map<string, { url: string; altText: string | null }>();
  try {
    imageByCollectionId = await fetchCollectionImagesFromShopify(
      admin,
      collections.map((collection) => collection.shopifyCollectionId),
    );
  } catch (error) {
    console.warn(
      `[collection-management] Could not load collection images for ${shopDomain}:`,
      error,
    );
  }

  const items: CollectionManagementItem[] = collections.map((collection) =>
    toManagementItem(
      collection,
      imageByCollectionId.get(collection.shopifyCollectionId),
      sortStatusByCollection.get(collection.id) ?? {
        state: "never",
        lastSortedAt: null,
        failedAt: null,
      },
    ),
  );

  const sortability = buildSortabilityReport(items);

  console.log(
    `[collection-management] Sortability for ${shopDomain}: ` +
      `sortable=${sortability.sortable.length} blocked=${sortability.blocked.length}`,
  );
  for (const entry of sortability.blocked) {
    console.log(
      `[collection-management] blocked collection=${entry.title} ` +
        `sortOrder=${entry.sortOrder}`,
    );
  }

  return {
    collections: items,
    counts: {
      all: items.length,
      enabled: items.filter((item) => item.enabled).length,
      disabled: items.filter((item) => !item.enabled).length,
    },
    sortability,
  };
}

export async function setCollectionEnabled(
  shopDomain: string,
  collectionId: string,
  enabled: boolean,
  admin: AdminGraphql,
): Promise<SetCollectionEnabledResult | null> {
  const shop = await ensureShop(shopDomain);

  const existing = await prisma.collection.findFirst({
    where: { id: collectionId, shopId: shop.id },
    include: {
      _count: {
        select: { productPositions: true },
      },
    },
  });

  if (!existing) {
    return null;
  }

  if (enabled && !existing.enabled) {
    await assertWithinCollectionLimit(shopDomain, 1);
  }

  const snapshot = await fetchCollectionFromShopify(
    admin,
    existing.shopifyCollectionId,
  );
  const liveSortOrder = snapshot
    ? mapShopifySortOrder(snapshot.sortOrder)
    : existing.sortOrder;
  const now = new Date();
  const title = snapshot?.title ?? existing.title;

  let sortOrderForDb = liveSortOrder;
  if (enabled && !existing.enabled) {
    sortOrderForDb = await ensureManualSortOrderForEnable(
      admin,
      existing.shopifyCollectionId,
      title,
      liveSortOrder,
    );
  }

  const collection = await prisma.collection.update({
    where: { id: existing.id },
    data: {
      enabled,
      sortOrder: sortOrderForDb,
      title,
      lastSyncedAt: snapshot ? now : existing.lastSyncedAt,
      enabledAt: enabled ? now : null,
      lastSortAttemptAt: null,
    },
    include: {
      _count: {
        select: { productPositions: true },
      },
    },
  });

  const sortStatusMap = await getCollectionSortStatusMap(shopDomain, [
    {
      id: collection.id,
      shopifyCollectionId: collection.shopifyCollectionId,
      enabled: collection.enabled,
      lastSortedAt: collection.lastSortedAt,
      enabledAt: collection.enabledAt,
      lastSortAttemptAt: collection.lastSortAttemptAt,
    },
  ]);

  const item = toManagementItem(
    collection,
    undefined,
    sortStatusMap.get(collection.id) ?? {
      state: collection.lastSortedAt ? "completed" : "never",
      lastSortedAt: collection.lastSortedAt?.toISOString() ?? null,
      failedAt: null,
    },
  );

  return {
    item,
    sortBlockedReason: item.sortBlockedReason,
  };
}

export async function getCollectionDetails(
  shopDomain: string,
  collectionId: string,
  admin: AdminGraphql,
): Promise<CollectionDetails | null> {
  const shop = await ensureShop(shopDomain);

  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, shopId: shop.id },
    include: {
      productPositions: {
        include: {
          trackedProduct: {
            select: {
              id: true,
              title: true,
              shopifyProductId: true,
              isSoldOut: true,
              tracksInventory: true,
            },
          },
        },
      },
    },
  });

  if (!collection) {
    return null;
  }

  const snapshot = await fetchCollectionFromShopify(
    admin,
    collection.shopifyCollectionId,
  );
  const syncedAt = new Date();

  const refreshedCollection = snapshot
    ? await prisma.collection.update({
        where: { id: collection.id },
        data: {
          title: snapshot.title,
          sortOrder: mapShopifySortOrder(snapshot.sortOrder),
          lastSyncedAt: syncedAt,
        },
        include: {
          productPositions: {
            include: {
              trackedProduct: {
                select: {
                  id: true,
                  title: true,
                  shopifyProductId: true,
                  isSoldOut: true,
                  tracksInventory: true,
                },
              },
            },
          },
        },
      })
    : collection;

  const [liveProducts, lastReorderLog, imageMap, sortStatusMap] =
    await Promise.all([
      fetchCollectionProductsFromShopify(
        admin,
        refreshedCollection.shopifyCollectionId,
      ),
      prisma.activityLog?.findFirst
        ? prisma.activityLog.findFirst({
            where: {
              shopId: shop.id,
              collectionId: refreshedCollection.id,
              type: { in: REORDER_ACTIVITY_TYPES },
            },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve(null),
      fetchCollectionImagesFromShopify(admin, [
        refreshedCollection.shopifyCollectionId,
      ]).catch(() => new Map()),
      getCollectionSortStatusMap(shopDomain, [
        {
          id: refreshedCollection.id,
          shopifyCollectionId: refreshedCollection.shopifyCollectionId,
          enabled: refreshedCollection.enabled,
          lastSortedAt: refreshedCollection.lastSortedAt,
          enabledAt: refreshedCollection.enabledAt,
          lastSortAttemptAt: refreshedCollection.lastSortAttemptAt,
        },
      ]),
    ]);

  const positionByProductGid = new Map(
    refreshedCollection.productPositions.map((position) => [
      position.trackedProduct.shopifyProductId,
      position,
    ]),
  );

  const products: CollectionProductRow[] = liveProducts.map((product, index) => {
    const position = positionByProductGid.get(product.id);
    const tracked = position?.trackedProduct;
    const isSoldOut = tracked?.isSoldOut ?? false;
    const status =
      tracked == null
        ? "Unknown"
        : !tracked.tracksInventory
          ? "Unknown"
          : formatInventoryStatusLabel(isSoldOut ? "SOLD_OUT" : "IN_STOCK");

    return {
      position: index,
      productId: product.id,
      title: product.title,
      imageUrl: product.featuredImage?.url ?? null,
      imageAlt: product.featuredImage?.altText ?? product.title,
      inventoryStatus: status,
      isSoldOut,
      originalPosition: position?.originalPosition ?? null,
      currentPosition: position?.currentPosition ?? index,
    };
  });

  const image = imageMap.get(refreshedCollection.shopifyCollectionId);
  const sortBlockedReason = getCollectionSortBlockedReason(
    refreshedCollection.enabled,
    refreshedCollection.sortOrder,
  );

  return {
    id: refreshedCollection.id,
    shopifyCollectionId: refreshedCollection.shopifyCollectionId,
    title: refreshedCollection.title,
    imageUrl: image?.url ?? null,
    imageAlt: image?.altText ?? refreshedCollection.title,
    productCount: products.length,
    sortOrder: refreshedCollection.sortOrder,
    sortOrderLabel: formatCollectionSortOrderLabel(refreshedCollection.sortOrder),
    enabled: refreshedCollection.enabled,
    isSortable: refreshedCollection.enabled && refreshedCollection.sortOrder === "MANUAL",
    sortBlockedReason,
    lastSyncedAt: refreshedCollection.lastSyncedAt?.toISOString() ?? null,
    lastSortedAt:
      sortStatusMap.get(refreshedCollection.id)?.lastSortedAt ??
      refreshedCollection.lastSortedAt?.toISOString() ??
      null,
    sortStatus: sortStatusMap.get(refreshedCollection.id) ?? {
      state: refreshedCollection.lastSortedAt ? "completed" : "never",
      lastSortedAt: refreshedCollection.lastSortedAt?.toISOString() ?? null,
      failedAt: null,
    },
    lastReorderActivity: lastReorderLog
      ? {
          label: formatActivityTypeLabel(lastReorderLog.type),
          occurredAt: lastReorderLog.createdAt.toISOString(),
          productTitle: lastReorderLog.productTitle,
          oldPosition: lastReorderLog.oldPosition,
          newPosition: lastReorderLog.newPosition,
          detail: lastReorderLog.detail,
        }
      : null,
    products,
    soldOutCount: products.filter((product) => product.isSoldOut).length,
  };
}

export async function findCollectionIdByShopifyGid(
  shopDomain: string,
  shopifyCollectionId: string,
): Promise<string | null> {
  const shop = await ensureShop(shopDomain);
  const collection = await prisma.collection.findUnique({
    where: {
      shopId_shopifyCollectionId: {
        shopId: shop.id,
        shopifyCollectionId: toCollectionGid(shopifyCollectionId),
      },
    },
    select: { id: true },
  });

  return collection?.id ?? null;
}
