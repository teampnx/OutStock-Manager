import type { ActionFunctionArgs } from "react-router";

import {
  logCustomerRedact,
  recordGdprWebhookReceipt,
} from "../lib/gdpr-compliance.server";
import { resolveShopId } from "../models/job.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, payload } = await authenticate.webhook(request);

  const shopId = await resolveShopId(shop);

  await recordGdprWebhookReceipt({
    shopifyWebhookId: webhookId,
    shopDomain: shop,
    topic: "customers/redact",
    shopId,
  });

  logCustomerRedact({
    shopDomain: shop,
    shopifyWebhookId: webhookId,
    payload: payload as Record<string, unknown>,
  });

  console.log(`[gdpr-compliance] Processed ${topic} for ${shop}`);

  return new Response();
};
