import type { Job } from "@prisma/client";

import { getAdminForShop } from "../../lib/shopify-admin.server";
import { isCollectionEnabledForReorder } from "../../models/collection-enabled.server";
import { reorderSoldOutProductInCollection } from "../../models/collection-reorder.server";
import { getSettingsForShop } from "../../models/settings.server";

type ReorderSoldOutPayload = {
  shopifyCollectionId?: string;
  shopifyProductId?: string;
};

export async function processReorderSoldOutProductJob(job: Job): Promise<void> {
  const payload = job.payload as ReorderSoldOutPayload;
  const shopifyCollectionId = payload.shopifyCollectionId;
  const shopifyProductId = payload.shopifyProductId;

  if (!shopifyCollectionId || !shopifyProductId) {
    throw new Error("Missing shopifyCollectionId or shopifyProductId in payload");
  }

  const settings = await getSettingsForShop(job.shopDomain);
  if (!settings.enabled || !settings.pushSoldOutToBottom) {
    return;
  }

  if (!(await isCollectionEnabledForReorder(job.shopDomain, shopifyCollectionId))) {
    return;
  }

  const admin = await getAdminForShop(job.shopDomain);
  await reorderSoldOutProductInCollection(
    job.shopDomain,
    admin,
    shopifyCollectionId,
    shopifyProductId,
  );
}
