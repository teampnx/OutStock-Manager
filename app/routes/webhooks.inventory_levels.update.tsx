import type { ActionFunctionArgs } from "react-router";

import { ingestWebhook } from "../lib/webhook-ingest.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, payload } = await authenticate.webhook(request);

  const inventoryItemId =
    payload.inventory_item_id != null
      ? String(payload.inventory_item_id)
      : null;

  const dedupeKey = inventoryItemId
    ? `${shop}:inventory:${inventoryItemId}`
    : undefined;

  await ingestWebhook({
    shopifyWebhookId: webhookId,
    shopDomain: shop,
    topic,
    jobType: "PROCESS_INVENTORY_CHANGE",
    payload: payload as Record<string, unknown>,
    dedupeKey,
  });

  return new Response();
};
