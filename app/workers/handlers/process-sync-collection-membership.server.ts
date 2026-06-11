import type { Job } from "@prisma/client";

import { getAdminForShop } from "../../lib/shopify-admin.server";
import { syncCollectionMembership } from "../../models/collection.server";

type SyncCollectionMembershipPayload = {
  shopifyCollectionId?: string;
};

export async function processSyncCollectionMembershipJob(
  job: Job,
): Promise<void> {
  const payload = job.payload as SyncCollectionMembershipPayload;

  if (!payload.shopifyCollectionId) {
    throw new Error(
      "Missing shopifyCollectionId in SYNC_COLLECTION_MEMBERSHIP job",
    );
  }

  const admin = await getAdminForShop(job.shopDomain);
  const collection = await syncCollectionMembership(
    job.shopDomain,
    admin,
    payload.shopifyCollectionId,
  );

  if (!collection) {
    throw new Error(
      `Collection not found for membership sync: ${payload.shopifyCollectionId}`,
    );
  }
}
