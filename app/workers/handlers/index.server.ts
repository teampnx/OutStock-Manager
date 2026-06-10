import type { Job } from "@prisma/client";

import { processInventoryChangeJob } from "./process-inventory-change.server";
import { processProductUpdateJob } from "./process-product-update.server";

export async function processJob(job: Job): Promise<void> {
  switch (job.type) {
    case "PROCESS_INVENTORY_CHANGE":
      await processInventoryChangeJob(job);
      return;
    case "PROCESS_PRODUCT_UPDATE":
      await processProductUpdateJob(job);
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
