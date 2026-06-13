import type { ActionFunctionArgs } from "react-router";

import { ingestWebhook } from "../lib/webhook-ingest.server";
import { logGdprCompliance } from "../models/shop-cleanup.server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic, webhookId, payload } =
    await authenticate.webhook(request);

  logGdprCompliance("info", "App uninstalled — enqueueing shop cleanup", {
    shopDomain: shop,
    shopifyWebhookId: webhookId,
  });

  await ingestWebhook({
    shopifyWebhookId: webhookId,
    shopDomain: shop,
    topic,
    jobType: "CLEANUP_SHOP",
    payload: payload as Record<string, unknown>,
    dedupeKey: `${shop}:cleanup:${webhookId}`,
  });

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
    logGdprCompliance("info", "Sessions deleted on uninstall", {
      shopDomain: shop,
    });
  }

  return new Response();
};
