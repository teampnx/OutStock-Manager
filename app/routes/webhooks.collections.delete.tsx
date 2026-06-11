import type { ActionFunctionArgs } from "react-router";

import { ingestWebhook } from "../lib/webhook-ingest.server";
import { resolveShopifyCollectionId } from "../models/collection.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, payload } = await authenticate.webhook(request);
  const shopifyCollectionId = resolveShopifyCollectionId(
    payload as Record<string, unknown>,
  );

  const dedupeKey = shopifyCollectionId
    ? `${shop}:collection-delete:${shopifyCollectionId}:${webhookId}`
    : undefined;

  await ingestWebhook({
    shopifyWebhookId: webhookId,
    shopDomain: shop,
    topic,
    jobType: "SYNC_COLLECTION",
    payload: {
      ...(payload as Record<string, unknown>),
      shopifyCollectionId,
      deleted: true,
    },
    dedupeKey,
  });

  return new Response();
};
