import type { Job, RestorePosition } from "@prisma/client";

import { getAdminForShop } from "../../lib/shopify-admin.server";
import { isCollectionEnabledForReorder } from "../../models/collection-enabled.server";
import { restoreProductPositionInCollection } from "../../models/collection-reorder.server";
import { getSettingsForShop } from "../../models/settings.server";

type RestorePositionPayload = {
  shopifyCollectionId?: string;
  shopifyProductId?: string;
  restorePosition?: RestorePosition;
};

export async function processRestoreProductPositionJob(
  job: Job,
): Promise<void> {
  const payload = job.payload as RestorePositionPayload;
  const shopifyCollectionId = payload.shopifyCollectionId;
  const shopifyProductId = payload.shopifyProductId;

  if (!shopifyCollectionId || !shopifyProductId) {
    throw new Error("Missing shopifyCollectionId or shopifyProductId in payload");
  }

  const settings = await getSettingsForShop(job.shopDomain);
  if (!settings.enabled || !settings.restoreWhenBackInStock) {
    return;
  }

  if (!(await isCollectionEnabledForReorder(job.shopDomain, shopifyCollectionId))) {
    return;
  }

  const restorePosition = settings.restorePosition;
  const admin = await getAdminForShop(job.shopDomain);
  await restoreProductPositionInCollection(
    job.shopDomain,
    admin,
    shopifyCollectionId,
    shopifyProductId,
    restorePosition,
  );
}
