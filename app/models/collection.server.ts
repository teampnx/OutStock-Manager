import type { Collection } from "@prisma/client";

import { mapShopifySortOrder } from "../lib/collection-sort-order";
import prisma from "../db.server";
import {
  fetchAllCollectionsFromShopify,
  fetchCollectionFromShopify,
  fetchCollectionProductsFromShopify,
  toCollectionGid,
} from "../services/shopify-collections.server";
import { recordActivityLog } from "./activity-log.server";
import { ensureShop } from "./shop.server";
import { enqueueJob } from "./job.server";
import { ensureTrackedProductPlaceholder } from "./tracked-product.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type CollectionListItem = {
  id: string;
  title: string;
  productCount: number;
  lastSyncedAt: string | null;
};

function resolveShopifyCollectionId(
  payload: Record<string, unknown>,
): string | null {
  if (typeof payload.shopifyCollectionId === "string") {
    return toCollectionGid(payload.shopifyCollectionId);
  }
  if (typeof payload.admin_graphql_api_id === "string") {
    return toCollectionGid(payload.admin_graphql_api_id);
  }
  if (payload.id != null) {
    return toCollectionGid(String(payload.id));
  }
  return null;
}

export async function syncCollection(
  shopDomain: string,
  admin: AdminGraphql,
  shopifyCollectionId: string,
): Promise<Collection | null> {
  const snapshot = await fetchCollectionFromShopify(admin, shopifyCollectionId);
  if (!snapshot) {
    return null;
  }

  const shop = await ensureShop(shopDomain);

  return prisma.collection.upsert({
    where: {
      shopId_shopifyCollectionId: {
        shopId: shop.id,
        shopifyCollectionId: snapshot.shopifyCollectionId,
      },
    },
    create: {
      shopId: shop.id,
      shopifyCollectionId: snapshot.shopifyCollectionId,
      title: snapshot.title,
      sortOrder: mapShopifySortOrder(snapshot.sortOrder),
    },
    update: {
      title: snapshot.title,
      sortOrder: mapShopifySortOrder(snapshot.sortOrder),
    },
  });
}

export async function syncCollectionMembership(
  shopDomain: string,
  admin: AdminGraphql,
  shopifyCollectionId: string,
): Promise<Collection | null> {
  const shop = await ensureShop(shopDomain);
  const collection = await prisma.collection.findUnique({
    where: {
      shopId_shopifyCollectionId: {
        shopId: shop.id,
        shopifyCollectionId: toCollectionGid(shopifyCollectionId),
      },
    },
  });

  if (!collection) {
    return null;
  }

  const products = await fetchCollectionProductsFromShopify(
    admin,
    collection.shopifyCollectionId,
  );
  const now = new Date();
  const seenTrackedProductIds: string[] = [];

  for (let position = 0; position < products.length; position++) {
    const product = products[position];
    const trackedProduct = await ensureTrackedProductPlaceholder(
      shop.id,
      product.id,
      product.title,
    );
    seenTrackedProductIds.push(trackedProduct.id);

    const existing = await prisma.collectionProductPosition.findUnique({
      where: {
        collectionId_trackedProductId: {
          collectionId: collection.id,
          trackedProductId: trackedProduct.id,
        },
      },
    });

    if (existing) {
      await prisma.collectionProductPosition.update({
        where: { id: existing.id },
        data: {
          currentPosition: position,
          updatedAt: now,
        },
      });
    } else {
      await prisma.collectionProductPosition.create({
        data: {
          collectionId: collection.id,
          trackedProductId: trackedProduct.id,
          originalPosition: position,
          currentPosition: position,
        },
      });
    }
  }

  if (seenTrackedProductIds.length > 0) {
    await prisma.collectionProductPosition.deleteMany({
      where: {
        collectionId: collection.id,
        trackedProductId: { notIn: seenTrackedProductIds },
      },
    });
  } else {
    await prisma.collectionProductPosition.deleteMany({
      where: { collectionId: collection.id },
    });
  }

  const updated = await prisma.collection.update({
    where: { id: collection.id },
    data: { lastSyncedAt: now },
  });

  await recordActivityLog({
    shopDomain,
    type: "COLLECTION_SYNCED",
    collectionId: updated.id,
    collectionTitle: updated.title,
    detail: `${updated.title} synced · ${products.length} products`,
    metadata: { productCount: products.length },
  });

  return updated;
}

export async function deleteCollectionByShopifyId(
  shopDomain: string,
  shopifyCollectionId: string,
): Promise<void> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return;
  }

  const collectionGid = toCollectionGid(shopifyCollectionId);
  const existing = await prisma.collection.findUnique({
    where: {
      shopId_shopifyCollectionId: {
        shopId: shop.id,
        shopifyCollectionId: collectionGid,
      },
    },
  });

  if (existing) {
    await recordActivityLog({
      shopDomain,
      type: "COLLECTION_DELETED",
      collectionId: existing.id,
      collectionTitle: existing.title,
      detail: `${existing.title} removed from tracking`,
    });
  }

  await prisma.collection.deleteMany({
    where: {
      shopId: shop.id,
      shopifyCollectionId: collectionGid,
    },
  });
}

export async function enqueueCollectionSync(
  shopDomain: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const shopifyCollectionId = resolveShopifyCollectionId(payload);
  if (!shopifyCollectionId) {
    throw new Error("Missing collection id in job payload");
  }

  await enqueueJob({
    shopDomain,
    type: "SYNC_COLLECTION",
    payload: {
      ...payload,
      shopifyCollectionId,
    },
    dedupeKey: `${shopDomain}:collection:${shopifyCollectionId}`,
    priority: 15,
  });
}

export async function enqueueCollectionMembershipSync(
  shopDomain: string,
  shopifyCollectionId: string,
): Promise<void> {
  const gid = toCollectionGid(shopifyCollectionId);

  await enqueueJob({
    shopDomain,
    type: "SYNC_COLLECTION_MEMBERSHIP",
    payload: { shopifyCollectionId: gid },
    dedupeKey: `${shopDomain}:collection-membership:${gid}`,
    priority: 20,
  });
}

export { resolveShopifyCollectionId };

export type BackfillCollectionsResult = {
  shopifyCount: number;
  syncedCount: number;
  positionRows: number;
};

export async function backfillCollectionsForShop(
  shopDomain: string,
  admin: AdminGraphql,
): Promise<BackfillCollectionsResult> {
  const shopifyCollections = await fetchAllCollectionsFromShopify(admin);
  let syncedCount = 0;

  for (const snapshot of shopifyCollections) {
    await syncCollection(shopDomain, admin, snapshot.shopifyCollectionId);
    const collection = await syncCollectionMembership(
      shopDomain,
      admin,
      snapshot.shopifyCollectionId,
    );
    if (collection) {
      syncedCount++;
    }
  }

  const shop = await ensureShop(shopDomain);
  const positionRows = await prisma.collectionProductPosition.count({
    where: { collection: { shopId: shop.id } },
  });

  const result = {
    shopifyCount: shopifyCollections.length,
    syncedCount,
    positionRows,
  };

  await recordActivityLog({
    shopDomain,
    type: "BACKFILL_COLLECTIONS_COMPLETED",
    detail:
      `${result.syncedCount} collections synced · ` +
      `${result.positionRows} product positions stored`,
    metadata: result,
  });

  return result;
}

export async function enqueueBackfillCollections(
  shopDomain: string,
): Promise<void> {
  await enqueueJob({
    shopDomain,
    type: "BACKFILL_COLLECTIONS",
    payload: { source: "one-time-backfill" },
    dedupeKey: `${shopDomain}:backfill-collections`,
    priority: 100,
    runAt: new Date(),
  });
}

export async function listCollectionsForShop(
  shopDomain: string,
): Promise<CollectionListItem[]> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return [];
  }

  const collections = await prisma.collection.findMany({
    where: { shopId: shop.id },
    include: {
      _count: {
        select: { productPositions: true },
      },
    },
    orderBy: [{ lastSyncedAt: "desc" }, { title: "asc" }],
  });

  return collections.map((collection) => ({
    id: collection.id,
    title: collection.title,
    productCount: collection._count.productPositions,
    lastSyncedAt: collection.lastSyncedAt?.toISOString() ?? null,
  }));
}
