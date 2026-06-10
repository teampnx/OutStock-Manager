import type { Job } from "@prisma/client";

import { getAdminForShop } from "../../lib/shopify-admin.server";
import { syncProductInventory } from "../../models/tracked-product.server";
import { resolveProductIdFromInventoryItem } from "../../services/shopify-product-inventory.server";

type InventoryJobPayload = {
  inventory_item_id?: number | string;
  available?: number;
  location_id?: number | string;
  shopifyWebhookId?: string;
  topic?: string;
};

export async function processInventoryChangeJob(job: Job): Promise<void> {
  const payload = job.payload as InventoryJobPayload;
  const inventoryItemId = payload.inventory_item_id;

  if (inventoryItemId == null) {
    throw new Error("Missing inventory_item_id in job payload");
  }

  const admin = await getAdminForShop(job.shopDomain);
  const shopifyProductId = await resolveProductIdFromInventoryItem(
    admin,
    inventoryItemId,
  );

  if (!shopifyProductId) {
    console.warn(
      `[job-worker] No product found for inventory item ${inventoryItemId} (${job.shopDomain})`,
    );
    return;
  }

  await syncProductInventory({
    shopDomain: job.shopDomain,
    shopifyProductId,
    admin,
    triggerSource: "WEBHOOK_INVENTORY",
    shopifyWebhookId: payload.shopifyWebhookId ?? null,
    metadata: {
      inventoryItemId: String(inventoryItemId),
      available: payload.available ?? null,
      locationId: payload.location_id ?? null,
      topic: payload.topic ?? null,
    },
  });
}
