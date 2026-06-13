import type { Job } from "@prisma/client";

import { deleteAllShopData } from "../../models/shop-cleanup.server";

export async function processCleanupShopJob(job: Job): Promise<void> {
  await deleteAllShopData(job.shopDomain, "cleanup_job");
}
