import {
  isWebhookProcessed,
  recordWebhookEvent,
} from "../models/webhook-event.server";
import { logGdprCompliance } from "../models/shop-cleanup.server";

export type GdprWebhookTopic =
  | "customers/data_request"
  | "customers/redact"
  | "shop/redact";

export async function recordGdprWebhookReceipt(input: {
  shopifyWebhookId: string;
  shopDomain: string;
  topic: GdprWebhookTopic;
  shopId?: string | null;
}): Promise<boolean> {
  if (await isWebhookProcessed(input.shopifyWebhookId)) {
    logGdprCompliance("info", "Duplicate GDPR webhook ignored", {
      topic: input.topic,
      shopDomain: input.shopDomain,
      shopifyWebhookId: input.shopifyWebhookId,
    });
    return false;
  }

  const recorded = await recordWebhookEvent({
    shopifyWebhookId: input.shopifyWebhookId,
    shopDomain: input.shopDomain,
    topic: input.topic,
    shopId: input.shopId ?? null,
  });

  if (!recorded) {
    logGdprCompliance("info", "GDPR webhook already recorded (race)", {
      topic: input.topic,
      shopDomain: input.shopDomain,
      shopifyWebhookId: input.shopifyWebhookId,
    });
    return false;
  }

  logGdprCompliance("info", "GDPR webhook recorded", {
    topic: input.topic,
    shopDomain: input.shopDomain,
    shopifyWebhookId: input.shopifyWebhookId,
  });

  return true;
}

/**
 * Curatify stores product/collection/inventory data per shop only.
 * It does not persist Shopify customer PII (names, emails, addresses, orders).
 */
export function logCustomerDataRequest(input: {
  shopDomain: string;
  shopifyWebhookId: string;
  payload: Record<string, unknown>;
}): void {
  const customerId =
    typeof input.payload.customer === "object" &&
    input.payload.customer !== null &&
    "id" in input.payload.customer
      ? String((input.payload.customer as { id: unknown }).id)
      : "unknown";

  logGdprCompliance("info", "Customer data request received — no customer PII stored", {
    shopDomain: input.shopDomain,
    shopifyWebhookId: input.shopifyWebhookId,
    customerId,
  });
}

export function logCustomerRedact(input: {
  shopDomain: string;
  shopifyWebhookId: string;
  payload: Record<string, unknown>;
}): void {
  const customerId =
    typeof input.payload.customer === "object" &&
    input.payload.customer !== null &&
    "id" in input.payload.customer
      ? String((input.payload.customer as { id: unknown }).id)
      : "unknown";

  logGdprCompliance("info", "Customer redact received — no customer PII to delete", {
    shopDomain: input.shopDomain,
    shopifyWebhookId: input.shopifyWebhookId,
    customerId,
  });
}
