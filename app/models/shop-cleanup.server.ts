import prisma from "../db.server";

export type ShopCleanupTrigger =
  | "app_uninstalled"
  | "shop_redact"
  | "cleanup_job";

export type ShopCleanupCounts = {
  activityLogs: number;
  collectionProductPositions: number;
  originalCollectionPositions: number;
  collectionMemberships: number;
  inventoryStatusHistories: number;
  collections: number;
  trackedProducts: number;
  pinnedProducts: number;
  jobs: number;
  webhookEvents: number;
  subscriptions: number;
  settings: number;
  shops: number;
  sessions: number;
};

export type ShopCleanupResult = {
  shopDomain: string;
  shopFound: boolean;
  trigger: ShopCleanupTrigger;
  deleted: ShopCleanupCounts;
};

function logCompliance(
  level: "info" | "warn" | "error",
  message: string,
  details?: Record<string, unknown>,
): void {
  const payload = details ? ` ${JSON.stringify(details)}` : "";
  const line = `[gdpr-compliance] ${message}${payload}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * Deletes all app-owned data for a shop. Used for app/uninstalled (via job),
 * shop/redact, and GDPR compliance. Runs in a single Prisma transaction.
 */
export async function deleteAllShopData(
  shopDomain: string,
  trigger: ShopCleanupTrigger,
): Promise<ShopCleanupResult> {
  logCompliance("info", "Starting shop data deletion", { shopDomain, trigger });

  const deleted: ShopCleanupCounts = {
    activityLogs: 0,
    collectionProductPositions: 0,
    originalCollectionPositions: 0,
    collectionMemberships: 0,
    inventoryStatusHistories: 0,
    collections: 0,
    trackedProducts: 0,
    pinnedProducts: 0,
    jobs: 0,
    webhookEvents: 0,
    subscriptions: 0,
    settings: 0,
    shops: 0,
    sessions: 0,
  };

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (shop) {
    await prisma.$transaction(async (tx) => {
      const shopId = shop.id;

      const activityLogs = await tx.activityLog.deleteMany({ where: { shopId } });
      deleted.activityLogs = activityLogs.count;

      const collectionProductPositions =
        await tx.collectionProductPosition.deleteMany({
          where: { collection: { shopId } },
        });
      deleted.collectionProductPositions = collectionProductPositions.count;

      const originalCollectionPositions =
        await tx.originalCollectionPosition.deleteMany({
          where: { membership: { shopId } },
        });
      deleted.originalCollectionPositions = originalCollectionPositions.count;

      const collectionMemberships = await tx.collectionMembership.deleteMany({
        where: { shopId },
      });
      deleted.collectionMemberships = collectionMemberships.count;

      const pinnedProducts = await tx.pinnedProduct.deleteMany({
        where: { shopId },
      });
      deleted.pinnedProducts = pinnedProducts.count;

      const inventoryStatusHistories =
        await tx.inventoryStatusHistory.deleteMany({ where: { shopId } });
      deleted.inventoryStatusHistories = inventoryStatusHistories.count;

      const collections = await tx.collection.deleteMany({ where: { shopId } });
      deleted.collections = collections.count;

      const trackedProducts = await tx.trackedProduct.deleteMany({
        where: { shopId },
      });
      deleted.trackedProducts = trackedProducts.count;

      const jobs = await tx.job.deleteMany({
        where: {
          OR: [{ shopId }, { shopDomain }],
        },
      });
      deleted.jobs = jobs.count;

      const webhookEvents = await tx.webhookEvent.deleteMany({
        where: { shopDomain },
      });
      deleted.webhookEvents = webhookEvents.count;

      const subscriptions = await tx.subscription.deleteMany({ where: { shopId } });
      deleted.subscriptions = subscriptions.count;

      const settings = await tx.settings.deleteMany({ where: { shopId } });
      deleted.settings = settings.count;

      await tx.shop.delete({ where: { id: shopId } });
      deleted.shops = 1;

      const sessions = await tx.session.deleteMany({ where: { shop: shopDomain } });
      deleted.sessions = sessions.count;
    });
  } else {
    await prisma.$transaction(async (tx) => {
      const jobs = await tx.job.deleteMany({ where: { shopDomain } });
      deleted.jobs = jobs.count;

      const webhookEvents = await tx.webhookEvent.deleteMany({
        where: { shopDomain },
      });
      deleted.webhookEvents = webhookEvents.count;

      const sessions = await tx.session.deleteMany({ where: { shop: shopDomain } });
      deleted.sessions = sessions.count;
    });
  }

  const result: ShopCleanupResult = {
    shopDomain,
    shopFound: Boolean(shop),
    trigger,
    deleted,
  };

  logCompliance("info", "Shop data deletion completed", {
    shopDomain,
    trigger,
    shopFound: result.shopFound,
    deleted,
  });

  return result;
}

export { logCompliance as logGdprCompliance };
