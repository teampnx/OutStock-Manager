import { PrismaClient } from "@prisma/client";

const shopDomain = "outstock-test-lionlx2x.myshopify.com";
const prisma = new PrismaClient();

async function getDashboardStats(shopDomain) {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return { error: "shop not found", stats: null };
  }

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
    prisma.activityLog.count({
      where: { shopId: shop.id, type: "PUSH_SOLD_OUT" },
    }),
    prisma.activityLog.count({
      where: {
        shopId: shop.id,
        type: { in: ["RESTORE_ORIGINAL", "RESTORE_TOP"] },
      },
    }),
    prisma.job.count({
      where: {
        shopId: shop.id,
        type: "REORDER_SOLD_OUT_PRODUCT",
        status: "COMPLETED",
      },
    }),
    prisma.job.count({
      where: {
        shopId: shop.id,
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
        shopId: shop.id,
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
  ].filter((value) => value != null);

  const lastSuccessfulSync =
    lastSyncCandidates.length > 0
      ? new Date(
          Math.max(...lastSyncCandidates.map((value) => value.getTime())),
        ).toISOString()
      : null;

  return {
    stats: {
      totalTrackedProducts,
      totalTrackedCollections,
      inStockProducts,
      soldOutProducts,
      productsMovedToBottom: Math.max(activityMovedCount, jobMovedCount),
      productsRestored: Math.max(activityRestoredCount, jobRestoredCount),
      lastSuccessfulSync,
    },
  };
}

const shop = await prisma.shop.findUnique({
  where: { shopDomain },
  include: { settings: true },
});

console.log(
  JSON.stringify(
    {
      shop: shop
        ? { id: shop.id, hasSettings: !!shop.settings, settingsId: shop.settings?.id }
        : null,
      dashboard: await getDashboardStats(shopDomain),
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
