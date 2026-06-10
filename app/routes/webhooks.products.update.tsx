import type { ActionFunctionArgs } from "react-router";

import { ingestWebhook } from "../lib/webhook-ingest.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, payload } = await authenticate.webhook(request);

  const productId =
    typeof payload.admin_graphql_api_id === "string"
      ? payload.admin_graphql_api_id
      : typeof payload.id === "number" || typeof payload.id === "string"
        ? String(payload.id)
        : null;

  const dedupeKey = productId ? `${shop}:product:${productId}` : undefined;

  await ingestWebhook({
    shopifyWebhookId: webhookId,
    shopDomain: shop,
    topic,
    jobType: "PROCESS_PRODUCT_UPDATE",
    payload: payload as Record<string, unknown>,
    dedupeKey,
  });

  return new Response();
};
