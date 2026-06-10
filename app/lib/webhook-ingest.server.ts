import type { JobType } from "@prisma/client";

import { enqueueJob, resolveShopId } from "../models/job.server";
import {
  isWebhookProcessed,
  recordWebhookEvent,
} from "../models/webhook-event.server";

export type WebhookIngestInput = {
  shopifyWebhookId: string;
  shopDomain: string;
  topic: string;
  jobType: JobType;
  payload: Record<string, unknown>;
  dedupeKey?: string;
};

export type WebhookIngestResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; error: string };

export async function ingestWebhook(
  input: WebhookIngestInput,
): Promise<WebhookIngestResult> {
  if (await isWebhookProcessed(input.shopifyWebhookId)) {
    return { ok: true, duplicate: true };
  }

  const shopId = await resolveShopId(input.shopDomain);

  const recorded = await recordWebhookEvent({
    shopifyWebhookId: input.shopifyWebhookId,
    shopDomain: input.shopDomain,
    topic: input.topic,
    shopId,
  });

  if (!recorded) {
    return { ok: true, duplicate: true };
  }

  await enqueueJob({
    shopDomain: input.shopDomain,
    shopId,
    type: input.jobType,
    payload: {
      ...input.payload,
      shopifyWebhookId: input.shopifyWebhookId,
      topic: input.topic,
    },
    dedupeKey: input.dedupeKey ?? null,
  });

  return { ok: true, duplicate: false };
}
