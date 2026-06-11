import type { Job } from "@prisma/client";

import { getAdminForShop } from "../../lib/shopify-admin.server";
import { enqueueCollectionReordersForStatusChange } from "../../models/collection-reorder.server";
import { syncProductInventory } from "../../models/tracked-product.server";
import { toProductGid } from "../../services/shopify-product-inventory.server";

type ProductJobPayload = {
  admin_graphql_api_id?: string;
  id?: number | string;
  shopifyWebhookId?: string;
  topic?: string;
};

function resolveProductId(payload: ProductJobPayload): string | null {
  if (typeof payload.admin_graphql_api_id === "string") {
    return toProductGid(payload.admin_graphql_api_id);
  }

  if (payload.id != null) {
    return toProductGid(payload.id);
  }

  return null;
}

export async function processProductUpdateJob(job: Job): Promise<void> {
  const payload = job.payload as ProductJobPayload;
  const shopifyProductId = resolveProductId(payload);

  if (!shopifyProductId) {
    throw new Error("Missing product id in job payload");
  }

  const admin = await getAdminForShop(job.shopDomain);

  const result = await syncProductInventory({
    shopDomain: job.shopDomain,
    shopifyProductId,
    admin,
    triggerSource: "WEBHOOK_PRODUCT",
    shopifyWebhookId: payload.shopifyWebhookId ?? null,
    metadata: {
      topic: payload.topic ?? null,
    },
  });

  if (result?.statusChanged) {
    await enqueueCollectionReordersForStatusChange(
      job.shopDomain,
      result.trackedProduct.id,
      shopifyProductId,
      result.previousStatus,
      result.newStatus,
    );
  }
}
