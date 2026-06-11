import type { Job } from "@prisma/client";

import { getAdminForShop } from "../../lib/shopify-admin.server";
import {
  deleteCollectionByShopifyId,
  enqueueCollectionMembershipSync,
  syncCollection,
} from "../../models/collection.server";

type SyncCollectionPayload = {
  shopifyCollectionId?: string;
  deleted?: boolean;
};

export async function processSyncCollectionJob(job: Job): Promise<void> {
  const payload = job.payload as SyncCollectionPayload;

  if (!payload.shopifyCollectionId) {
    throw new Error("Missing shopifyCollectionId in SYNC_COLLECTION job");
  }

  if (payload.deleted) {
    await deleteCollectionByShopifyId(
      job.shopDomain,
      payload.shopifyCollectionId,
    );
    return;
  }

  const admin = await getAdminForShop(job.shopDomain);
  const collection = await syncCollection(
    job.shopDomain,
    admin,
    payload.shopifyCollectionId,
  );

  if (!collection) {
    console.warn(
      `[job-worker] Collection not found in Shopify: ${payload.shopifyCollectionId}`,
    );
    return;
  }

  await enqueueCollectionMembershipSync(
    job.shopDomain,
    collection.shopifyCollectionId,
  );
}
