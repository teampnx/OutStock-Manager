import prisma from "../db.server";
import {
  collectionReorderProducts,
  fetchCollectionProductsFromShopify,
  pollShopifyJobUntilDone,
} from "../services/shopify-collections.server";
import { toProductGid } from "../services/shopify-product-inventory.server";
import { ensureShop } from "./shop.server";

export type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export async function getPinnedProductCount(collectionId: string): Promise<number> {
  return prisma.pinnedProduct.count({ where: { collectionId } });
}

function buildTargetProductOrder(
  liveProductIds: string[],
  pinOrder: string[],
  soldOutByProductGid: Map<string, boolean>,
): string[] {
  const pinnedSet = new Set(pinOrder);
  const liveSet = new Set(liveProductIds);

  const pinnedSection = pinOrder.filter((id) => liveSet.has(id));
  const unpinnedLive = liveProductIds.filter((id) => !pinnedSet.has(id));

  const inStock: string[] = [];
  const soldOut: string[] = [];

  for (const id of unpinnedLive) {
    if (soldOutByProductGid.get(id)) {
      soldOut.push(id);
    } else {
      inStock.push(id);
    }
  }

  return [...pinnedSection, ...inStock, ...soldOut];
}

/**
 * Applies collection sort: pinned (pin order) → in-stock unpinned → sold-out unpinned.
 * Preserves relative order within the in-stock and sold-out groups.
 */
export async function applyCollectionSortWithPins(
  shopDomain: string,
  admin: AdminGraphql,
  collectionId: string,
): Promise<void> {
  const shop = await ensureShop(shopDomain);
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, shopId: shop.id },
    select: {
      id: true,
      shopifyCollectionId: true,
      sortOrder: true,
    },
  });

  if (!collection || collection.sortOrder !== "MANUAL") {
    return;
  }

  const pins = await prisma.pinnedProduct.findMany({
    where: { collectionId },
    orderBy: { position: "asc" },
  });

  const liveProducts = await fetchCollectionProductsFromShopify(
    admin,
    collection.shopifyCollectionId,
  );

  if (liveProducts.length === 0) {
    return;
  }

  const liveIds = liveProducts.map((product) => product.id);
  const pinOrder = pins.map((pin) => toProductGid(pin.shopifyProductId));

  const tracked = await prisma.trackedProduct.findMany({
    where: {
      shopId: shop.id,
      shopifyProductId: { in: liveIds },
    },
    select: { shopifyProductId: true, isSoldOut: true },
  });

  const soldOutByProductGid = new Map(
    tracked.map((row) => [row.shopifyProductId, row.isSoldOut]),
  );

  const targetOrder = buildTargetProductOrder(
    liveIds,
    pinOrder,
    soldOutByProductGid,
  );

  const currentIndex = new Map(liveIds.map((id, index) => [id, index]));
  const moves: { productId: string; newPosition: number }[] = [];

  for (let targetIndex = 0; targetIndex < targetOrder.length; targetIndex++) {
    const productId = targetOrder[targetIndex];
    const current = currentIndex.get(productId);
    if (current !== undefined && current !== targetIndex) {
      moves.push({ productId, newPosition: targetIndex });
    }
  }

  if (moves.length === 0) {
    return;
  }

  moves.sort((a, b) => b.newPosition - a.newPosition);

  console.log(
    `[collection-sort-pins] Applying ${moves.length} moves ` +
      `shop=${shopDomain} collection=${collectionId}`,
  );

  const jobId = await collectionReorderProducts(
    admin,
    collection.shopifyCollectionId,
    moves,
  );
  await pollShopifyJobUntilDone(admin, jobId);
}

export async function getFirstPositionAfterPins(
  collectionId: string,
): Promise<number> {
  return prisma.pinnedProduct.count({ where: { collectionId } });
}
