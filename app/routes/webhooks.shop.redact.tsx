import type { ActionFunctionArgs } from "react-router";

import { recordGdprWebhookReceipt } from "../lib/gdpr-compliance.server";
import { deleteAllShopData } from "../models/shop-cleanup.server";
import { resolveShopId } from "../models/job.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId } = await authenticate.webhook(request);

  const shopId = await resolveShopId(shop);

  await recordGdprWebhookReceipt({
    shopifyWebhookId: webhookId,
    shopDomain: shop,
    topic: "shop/redact",
    shopId,
  });

  try {
    await deleteAllShopData(shop, "shop_redact");
    console.log(`[gdpr-compliance] Processed ${topic} for ${shop}`);
    return new Response();
  } catch (error) {
    console.error(
      `[gdpr-compliance] shop/redact failed for ${shop}:`,
      error instanceof Error ? error.message : error,
    );
    return new Response("Shop redact failed", { status: 500 });
  }
};
