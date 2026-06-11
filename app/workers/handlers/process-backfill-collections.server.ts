import type { Job } from "@prisma/client";

import { getAdminForShop } from "../../lib/shopify-admin.server";
import { backfillCollectionsForShop } from "../../models/collection.server";

export async function processBackfillCollectionsJob(job: Job): Promise<void> {
  const admin = await getAdminForShop(job.shopDomain);
  const result = await backfillCollectionsForShop(job.shopDomain, admin);

  console.log(
    `[job-worker] BACKFILL_COLLECTIONS shop=${job.shopDomain} ` +
      `shopify=${result.shopifyCount} synced=${result.syncedCount} ` +
      `positions=${result.positionRows}`,
  );
}
