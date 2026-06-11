import type { Job } from "@prisma/client";

import { processBackfillCollectionsJob } from "./process-backfill-collections.server";
import { processBackfillSoldOutProductsJob } from "./process-backfill-sold-out-products.server";
import { processInventoryChangeJob } from "./process-inventory-change.server";
import { processProductUpdateJob } from "./process-product-update.server";
import { processReorderSoldOutProductJob } from "./process-reorder-sold-out-product.server";
import { processRestoreProductPositionJob } from "./process-restore-product-position.server";
import { processSyncCollectionJob } from "./process-sync-collection.server";
import { processSyncCollectionMembershipJob } from "./process-sync-collection-membership.server";

export async function processJob(job: Job): Promise<void> {
  switch (job.type) {
    case "PROCESS_INVENTORY_CHANGE":
      await processInventoryChangeJob(job);
      return;
    case "PROCESS_PRODUCT_UPDATE":
      await processProductUpdateJob(job);
      return;
    case "SYNC_COLLECTION":
      await processSyncCollectionJob(job);
      return;
    case "SYNC_COLLECTION_MEMBERSHIP":
      await processSyncCollectionMembershipJob(job);
      return;
    case "BACKFILL_COLLECTIONS":
      await processBackfillCollectionsJob(job);
      return;
    case "BACKFILL_SOLD_OUT_PRODUCTS":
      await processBackfillSoldOutProductsJob(job);
      return;
    case "REORDER_SOLD_OUT_PRODUCT":
      await processReorderSoldOutProductJob(job);
      return;
    case "RESTORE_PRODUCT_POSITION":
      await processRestoreProductPositionJob(job);
      return;
    case "CLEANUP_SHOP":
      console.log(
        `[job-worker] CLEANUP_SHOP shop=${job.shopDomain} jobId=${job.id}`,
      );
      return;
    case "REORDER_COLLECTION_CHUNK":
    case "SYNC_PRODUCT_COLLECTIONS":
    case "BACKFILL_SHOP":
      console.log(
        `[job-worker] ${job.type} shop=${job.shopDomain} jobId=${job.id} (not implemented)`,
      );
      return;
    default: {
      const exhaustive: never = job.type;
      throw new Error(`Unknown job type: ${exhaustive}`);
    }
  }
}
