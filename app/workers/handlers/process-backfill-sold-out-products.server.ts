import type { Job } from "@prisma/client";

import prisma from "../../db.server";
import { getAdminForShop } from "../../lib/shopify-admin.server";
import { backfillSoldOutProductsForShop } from "../../models/collection-reorder.server";

export async function processBackfillSoldOutProductsJob(
  job: Job,
): Promise<void> {
  const admin = await getAdminForShop(job.shopDomain);
  const result = await backfillSoldOutProductsForShop(job.shopDomain, admin);

  await prisma.job.update({
    where: { id: job.id },
    data: {
      payload: {
        ...(typeof job.payload === "object" && job.payload !== null
          ? job.payload
          : {}),
        result,
      },
    },
  });

  console.log(
    `[job-worker] BACKFILL_SOLD_OUT_PRODUCTS shop=${job.shopDomain} ` +
      `scanned=${result.scannedProducts} reordered=${result.reordered} ` +
      `skipped=${result.skipped} failed=${result.failed}`,
  );
}
