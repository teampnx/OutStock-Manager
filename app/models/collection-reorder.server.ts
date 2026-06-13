import type { ActivityType, InventoryStatus, RestorePosition } from "@prisma/client";

import {
  applyCollectionSortWithPins,
  getFirstPositionAfterPins,
} from "./collection-sort-with-pins.server";
import prisma from "../db.server";
import { recordActivityLog } from "./activity-log.server";
import {
  collectionReorderProducts,
  fetchCollectionFromShopify,
  fetchCollectionProductsFromShopify,
  pollShopifyJobUntilDone,
  toCollectionGid,
} from "../services/shopify-collections.server";
import { toProductGid } from "../services/shopify-product-inventory.server";
import {
  markCollectionSortAttemptStarted,
  touchCollectionLastSortedAt,
} from "./collection-sort-status.server";
import { mapShopifySortOrder } from "../lib/collection-sort-order";
import { ensureShop } from "./shop.server";
import { enqueueJob } from "./job.server";
import { getSettingsForShop } from "./settings.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type CollectionReorderAction =
  | "PUSH_SOLD_OUT"
  | "RESTORE_ORIGINAL"
  | "RESTORE_TOP"
  | "SKIPPED_ALREADY_AT_TARGET"
  | "SKIPPED_NOT_MANUAL"
  | "SKIPPED_NOT_IN_COLLECTION";

export type SoldOutReorderOutcome =
  | {
      outcome: "reordered";
      oldPosition: number;
      newPosition: number;
    }
  | {
      outcome: "skipped";
      reason: CollectionReorderAction;
      oldPosition: number | null;
      newPosition: number | null;
    }
  | { outcome: "ignored" };

export type BackfillSoldOutProductsResult = {
  scannedProducts: number;
  scannedMemberships: number;
  reordered: number;
  skipped: number;
  failed: number;
};

type ReorderLogInput = {
  action: CollectionReorderAction;
  shopDomain: string;
  shopifyCollectionId: string;
  shopifyProductId: string;
  oldPosition: number | null;
  newPosition: number | null;
  detail?: string;
  collectionId?: string;
  trackedProductId?: string;
  productTitle?: string | null;
  collectionTitle?: string | null;
};

function actionToActivityType(action: CollectionReorderAction): ActivityType {
  switch (action) {
    case "PUSH_SOLD_OUT":
      return "PUSH_SOLD_OUT";
    case "RESTORE_ORIGINAL":
      return "RESTORE_ORIGINAL";
    case "RESTORE_TOP":
      return "RESTORE_TOP";
    default:
      return "REORDER_SKIPPED";
  }
}

async function logCollectionReorder(input: ReorderLogInput): Promise<void> {
  console.log(
    `[collection-reorder] action=${input.action} ` +
      `collectionId=${input.shopifyCollectionId} ` +
      `productId=${input.shopifyProductId} ` +
      `oldPosition=${input.oldPosition ?? "null"} ` +
      `newPosition=${input.newPosition ?? "null"}` +
      (input.detail ? ` detail=${input.detail}` : ""),
  );

  await recordActivityLog({
    shopDomain: input.shopDomain,
    type: actionToActivityType(input.action),
    trackedProductId: input.trackedProductId,
    collectionId: input.collectionId,
    productTitle: input.productTitle,
    collectionTitle: input.collectionTitle,
    oldPosition: input.oldPosition,
    newPosition: input.newPosition,
    detail: input.detail ?? input.action,
  });
}

async function findLiveProductIndex(
  admin: AdminGraphql,
  shopifyCollectionId: string,
  shopifyProductId: string,
): Promise<{ products: { id: string }[]; liveIndex: number } | null> {
  const products = await fetchCollectionProductsFromShopify(
    admin,
    shopifyCollectionId,
  );
  const productGid = toProductGid(shopifyProductId);
  const liveIndex = products.findIndex((product) => product.id === productGid);

  if (liveIndex === -1) {
    return null;
  }

  return { products, liveIndex };
}

async function applyCollectionMove(
  admin: AdminGraphql,
  shopifyCollectionId: string,
  shopifyProductId: string,
  newPosition: number,
): Promise<void> {
  const jobId = await collectionReorderProducts(admin, shopifyCollectionId, [
    { productId: shopifyProductId, newPosition },
  ]);
  await pollShopifyJobUntilDone(admin, jobId);
}

export async function reorderSoldOutProductInCollection(
  shopDomain: string,
  admin: AdminGraphql,
  shopifyCollectionId: string,
  shopifyProductId: string,
): Promise<SoldOutReorderOutcome> {
  const collectionGid = toCollectionGid(shopifyCollectionId);
  const productGid = toProductGid(shopifyProductId);
  const shop = await ensureShop(shopDomain);

  const collection = await prisma.collection.findUnique({
    where: {
      shopId_shopifyCollectionId: {
        shopId: shop.id,
        shopifyCollectionId: collectionGid,
      },
    },
  });

  if (!collection) {
    return { outcome: "ignored" };
  }

  if (collection.sortOrder !== "MANUAL") {
    await logCollectionReorder({
      action: "SKIPPED_NOT_MANUAL",
      shopDomain,
      shopifyCollectionId: collectionGid,
      shopifyProductId: productGid,
      oldPosition: null,
      newPosition: null,
      detail: `sortOrder=${collection.sortOrder}`,
      collectionId: collection.id,
      collectionTitle: collection.title,
    });
    return {
      outcome: "skipped",
      reason: "SKIPPED_NOT_MANUAL",
      oldPosition: null,
      newPosition: null,
    };
  }

  const trackedProduct = await prisma.trackedProduct.findUnique({
    where: {
      shopId_shopifyProductId: {
        shopId: shop.id,
        shopifyProductId: productGid,
      },
    },
  });

  if (!trackedProduct) {
    return { outcome: "ignored" };
  }

  const positionRow = await prisma.collectionProductPosition.findUnique({
    where: {
      collectionId_trackedProductId: {
        collectionId: collection.id,
        trackedProductId: trackedProduct.id,
      },
    },
  });

  if (!positionRow) {
    return { outcome: "ignored" };
  }

  const live = await findLiveProductIndex(admin, collectionGid, productGid);
  if (!live) {
    await logCollectionReorder({
      action: "SKIPPED_NOT_IN_COLLECTION",
      shopDomain,
      shopifyCollectionId: collectionGid,
      shopifyProductId: productGid,
      oldPosition: positionRow.currentPosition,
      newPosition: null,
      collectionId: collection.id,
      trackedProductId: trackedProduct.id,
      productTitle: trackedProduct.title,
      collectionTitle: collection.title,
    });
    return {
      outcome: "skipped",
      reason: "SKIPPED_NOT_IN_COLLECTION",
      oldPosition: positionRow.currentPosition,
      newPosition: null,
    };
  }

  const { products, liveIndex } = live;
  const bottomIndex = products.length - 1;

  if (liveIndex === bottomIndex) {
    await logCollectionReorder({
      action: "SKIPPED_ALREADY_AT_TARGET",
      shopDomain,
      shopifyCollectionId: collectionGid,
      shopifyProductId: productGid,
      oldPosition: liveIndex,
      newPosition: bottomIndex,
      detail: "already_at_bottom",
      collectionId: collection.id,
      trackedProductId: trackedProduct.id,
      productTitle: trackedProduct.title,
      collectionTitle: collection.title,
    });
    await prisma.collectionProductPosition.update({
      where: { id: positionRow.id },
      data: { currentPosition: bottomIndex },
    });
    await touchCollectionLastSortedAt(collection.id);
    return {
      outcome: "skipped",
      reason: "SKIPPED_ALREADY_AT_TARGET",
      oldPosition: liveIndex,
      newPosition: bottomIndex,
    };
  }

  const updateData: {
    originalPosition?: number;
    restorePositionCaptured?: boolean;
    currentPosition: number;
  } = { currentPosition: bottomIndex };

  if (!positionRow.restorePositionCaptured) {
    updateData.originalPosition = liveIndex;
    updateData.restorePositionCaptured = true;
  }

  await applyCollectionMove(admin, collectionGid, productGid, bottomIndex);

  await prisma.collectionProductPosition.update({
    where: { id: positionRow.id },
    data: updateData,
  });

  await logCollectionReorder({
    action: "PUSH_SOLD_OUT",
    shopDomain,
    shopifyCollectionId: collectionGid,
    shopifyProductId: productGid,
    oldPosition: liveIndex,
    newPosition: bottomIndex,
    collectionId: collection.id,
    trackedProductId: trackedProduct.id,
    productTitle: trackedProduct.title,
    collectionTitle: collection.title,
  });

  await touchCollectionLastSortedAt(collection.id);

  await applyCollectionSortWithPins(shopDomain, admin, collection.id);

  return {
    outcome: "reordered",
    oldPosition: liveIndex,
    newPosition: bottomIndex,
  };
}

export async function restoreProductPositionInCollection(
  shopDomain: string,
  admin: AdminGraphql,
  shopifyCollectionId: string,
  shopifyProductId: string,
  restorePosition: RestorePosition,
): Promise<void> {
  const collectionGid = toCollectionGid(shopifyCollectionId);
  const productGid = toProductGid(shopifyProductId);
  const shop = await ensureShop(shopDomain);

  const collection = await prisma.collection.findUnique({
    where: {
      shopId_shopifyCollectionId: {
        shopId: shop.id,
        shopifyCollectionId: collectionGid,
      },
    },
  });

  if (!collection) {
    return;
  }

  if (collection.sortOrder !== "MANUAL") {
    await logCollectionReorder({
      action: "SKIPPED_NOT_MANUAL",
      shopDomain,
      shopifyCollectionId: collectionGid,
      shopifyProductId: productGid,
      oldPosition: null,
      newPosition: null,
      detail: `sortOrder=${collection.sortOrder}`,
      collectionId: collection.id,
      collectionTitle: collection.title,
    });
    return;
  }

  const trackedProduct = await prisma.trackedProduct.findUnique({
    where: {
      shopId_shopifyProductId: {
        shopId: shop.id,
        shopifyProductId: productGid,
      },
    },
  });

  if (!trackedProduct) {
    return;
  }

  const positionRow = await prisma.collectionProductPosition.findUnique({
    where: {
      collectionId_trackedProductId: {
        collectionId: collection.id,
        trackedProductId: trackedProduct.id,
      },
    },
  });

  if (!positionRow) {
    return;
  }

  const live = await findLiveProductIndex(admin, collectionGid, productGid);
  if (!live) {
    await logCollectionReorder({
      action: "SKIPPED_NOT_IN_COLLECTION",
      shopDomain,
      shopifyCollectionId: collectionGid,
      shopifyProductId: productGid,
      oldPosition: positionRow.currentPosition,
      newPosition: null,
      collectionId: collection.id,
      trackedProductId: trackedProduct.id,
      productTitle: trackedProduct.title,
      collectionTitle: collection.title,
    });
    return;
  }

  const { liveIndex } = live;
  const pinnedCount = await getFirstPositionAfterPins(collection.id);
  const targetPosition =
    restorePosition === "TOP"
      ? pinnedCount
      : Math.max(positionRow.originalPosition, pinnedCount);
  const action: CollectionReorderAction =
    restorePosition === "TOP" ? "RESTORE_TOP" : "RESTORE_ORIGINAL";

  if (liveIndex === targetPosition) {
    await logCollectionReorder({
      action: "SKIPPED_ALREADY_AT_TARGET",
      shopDomain,
      shopifyCollectionId: collectionGid,
      shopifyProductId: productGid,
      oldPosition: liveIndex,
      newPosition: targetPosition,
      detail: restorePosition.toLowerCase(),
      collectionId: collection.id,
      trackedProductId: trackedProduct.id,
      productTitle: trackedProduct.title,
      collectionTitle: collection.title,
    });
    await prisma.collectionProductPosition.update({
      where: { id: positionRow.id },
      data: {
        currentPosition: targetPosition,
        restorePositionCaptured: false,
      },
    });
    return;
  }

  await applyCollectionMove(admin, collectionGid, productGid, targetPosition);

  await prisma.collectionProductPosition.update({
    where: { id: positionRow.id },
    data: {
      currentPosition: targetPosition,
      restorePositionCaptured: false,
    },
  });

  await logCollectionReorder({
    action,
    shopDomain,
    shopifyCollectionId: collectionGid,
    shopifyProductId: productGid,
    oldPosition: liveIndex,
    newPosition: targetPosition,
    collectionId: collection.id,
    trackedProductId: trackedProduct.id,
    productTitle: trackedProduct.title,
    collectionTitle: collection.title,
  });

  await applyCollectionSortWithPins(shopDomain, admin, collection.id);
}

export async function backfillSoldOutProductsForShop(
  shopDomain: string,
  admin: AdminGraphql,
): Promise<BackfillSoldOutProductsResult> {
  const shop = await ensureShop(shopDomain);

  const soldOutProducts = await prisma.trackedProduct.findMany({
    where: {
      shopId: shop.id,
      isSoldOut: true,
    },
    select: { id: true, shopifyProductId: true, title: true },
  });

  const memberships = await prisma.collectionProductPosition.findMany({
    where: {
      trackedProductId: { in: soldOutProducts.map((product) => product.id) },
      collection: {
        shopId: shop.id,
        sortOrder: "MANUAL",
        enabled: true,
      },
    },
    include: {
      collection: { select: { shopifyCollectionId: true, title: true } },
      trackedProduct: { select: { shopifyProductId: true, title: true } },
    },
  });

  let reordered = 0;
  let skipped = 0;
  let failed = 0;

  console.log(
    `[sold-out-backfill] shop=${shopDomain} products=${soldOutProducts.length} ` +
      `memberships=${memberships.length}`,
  );

  const membershipsByCollection = new Map<
    string,
    typeof memberships
  >();
  for (const membership of memberships) {
    const collectionGid = membership.collection.shopifyCollectionId;
    const group = membershipsByCollection.get(collectionGid) ?? [];
    group.push(membership);
    membershipsByCollection.set(collectionGid, group);
  }

  for (const [collectionGid, collectionMemberships] of membershipsByCollection) {
    await markCollectionSortAttemptStarted(collectionMemberships[0].collectionId);

    let liveSnapshot;
    try {
      liveSnapshot = await fetchCollectionFromShopify(admin, collectionGid);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown collection fetch error";
      failed += collectionMemberships.length;
      console.error(
        `[sold-out-backfill] failed collection=${collectionGid}: ${message}`,
      );
      continue;
    }

    if (liveSnapshot) {
      await prisma.collection.update({
        where: { id: collectionMemberships[0].collectionId },
        data: {
          sortOrder: mapShopifySortOrder(liveSnapshot.sortOrder),
          title: liveSnapshot.title,
          lastSyncedAt: new Date(),
        },
      });
    }

    if (!liveSnapshot || liveSnapshot.sortOrder !== "MANUAL") {
      skipped += collectionMemberships.length;
      console.log(
        `[sold-out-backfill] skip collection=${collectionGid} ` +
          `sortOrder=${liveSnapshot?.sortOrder ?? "missing"}`,
      );
      continue;
    }

    let liveProducts;
    try {
      liveProducts = await fetchCollectionProductsFromShopify(admin, collectionGid);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown product fetch error";
      failed += collectionMemberships.length;
      console.error(
        `[sold-out-backfill] failed collection=${collectionGid}: ${message}`,
      );
      continue;
    }

    const liveIndexByProduct = new Map(
      liveProducts.map((product, index) => [product.id, index]),
    );

    const bottomBlockStart =
      liveProducts.length - collectionMemberships.length;

    const workItems = collectionMemberships
      .map((membership) => ({
        membership,
        liveIndex: liveIndexByProduct.get(
          toProductGid(membership.trackedProduct.shopifyProductId),
        ),
      }))
      .sort((left, right) => {
        const leftIndex = left.liveIndex ?? -1;
        const rightIndex = right.liveIndex ?? -1;
        return rightIndex - leftIndex;
      });

    for (const { membership, liveIndex } of workItems) {
      if (
        liveIndex !== undefined &&
        liveIndex >= bottomBlockStart &&
        liveIndex < liveProducts.length
      ) {
        skipped++;
        await logCollectionReorder({
          action: "SKIPPED_ALREADY_AT_TARGET",
          shopDomain,
          shopifyCollectionId: collectionGid,
          shopifyProductId: membership.trackedProduct.shopifyProductId,
          oldPosition: liveIndex,
          newPosition: liveIndex,
          detail: "already_in_sold_out_bottom_block",
          collectionId: membership.collectionId,
          trackedProductId: membership.trackedProductId,
          productTitle: membership.trackedProduct.title,
          collectionTitle: membership.collection.title,
        });
        continue;
      }

      try {
        const result = await reorderSoldOutProductInCollection(
          shopDomain,
          admin,
          membership.collection.shopifyCollectionId,
          membership.trackedProduct.shopifyProductId,
        );

        if (result.outcome === "reordered") {
          reordered++;
        } else if (
          result.outcome === "skipped" ||
          result.outcome === "ignored"
        ) {
          skipped++;
        }
      } catch (error) {
        failed++;
        const message =
          error instanceof Error ? error.message : "Unknown reorder error";
        console.error(
          `[sold-out-backfill] failed collection=${membership.collection.shopifyCollectionId} ` +
            `product=${membership.trackedProduct.shopifyProductId}: ${message}`,
        );
      }
    }

    await touchCollectionLastSortedAt(collectionMemberships[0].collectionId);
    await applyCollectionSortWithPins(
      shopDomain,
      admin,
      collectionMemberships[0].collectionId,
    );
  }

  const summary: BackfillSoldOutProductsResult = {
    scannedProducts: soldOutProducts.length,
    scannedMemberships: memberships.length,
    reordered,
    skipped,
    failed,
  };

  console.log(
    `[sold-out-backfill] shop=${shopDomain} complete ` +
      `scanned=${summary.scannedProducts} reordered=${summary.reordered} ` +
      `skipped=${summary.skipped} failed=${summary.failed}`,
  );

  await recordActivityLog({
    shopDomain,
    type: "BACKFILL_SOLD_OUT_COMPLETED",
    detail:
      `scanned ${summary.scannedProducts} products · ` +
      `reordered ${summary.reordered} · skipped ${summary.skipped} · ` +
      `failed ${summary.failed}`,
    metadata: summary,
  });

  return summary;
}

export async function enqueueBackfillSoldOutProducts(shopDomain: string) {
  return enqueueJob({
    shopDomain,
    type: "BACKFILL_SOLD_OUT_PRODUCTS",
    payload: { source: "manual-sync" },
    dedupeKey: `${shopDomain}:backfill-sold-out-products`,
    priority: 50,
    runAt: new Date(),
  });
}

export async function enqueueCollectionReordersForStatusChange(
  shopDomain: string,
  trackedProductId: string,
  shopifyProductId: string,
  previousStatus: InventoryStatus,
  newStatus: InventoryStatus,
): Promise<void> {
  if (!trackedProductId || previousStatus === newStatus) {
    return;
  }

  if (newStatus !== "SOLD_OUT" && newStatus !== "IN_STOCK") {
    return;
  }

  const settings = await getSettingsForShop(shopDomain);
  if (!settings.enabled) {
    return;
  }

  if (newStatus === "SOLD_OUT" && !settings.pushSoldOutToBottom) {
    return;
  }

  if (newStatus === "IN_STOCK" && !settings.restoreWhenBackInStock) {
    return;
  }

  const shop = await ensureShop(shopDomain);
  const productGid = toProductGid(shopifyProductId);

  const positions = await prisma.collectionProductPosition.findMany({
    where: {
      trackedProductId,
      collection: {
        shopId: shop.id,
        sortOrder: "MANUAL",
        enabled: true,
      },
    },
    include: { collection: true },
  });

  for (const position of positions) {
    const collectionGid = position.collection.shopifyCollectionId;

    if (newStatus === "SOLD_OUT") {
      await enqueueJob({
        shopDomain,
        type: "REORDER_SOLD_OUT_PRODUCT",
        payload: {
          shopifyCollectionId: collectionGid,
          shopifyProductId: productGid,
        },
        dedupeKey: `${shopDomain}:reorder-sold-out:${collectionGid}:${productGid}`,
        priority: 5,
      });
      continue;
    }

    await enqueueJob({
      shopDomain,
      type: "RESTORE_PRODUCT_POSITION",
      payload: {
        shopifyCollectionId: collectionGid,
        shopifyProductId: productGid,
        restorePosition: settings.restorePosition,
      },
      dedupeKey: `${shopDomain}:restore-position:${collectionGid}:${productGid}`,
      priority: 5,
    });
  }
}
