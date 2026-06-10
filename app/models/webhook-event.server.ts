import prisma from "../db.server";

export type RecordWebhookEventInput = {
  shopifyWebhookId: string;
  shopDomain: string;
  topic: string;
  shopId?: string | null;
};

export async function isWebhookProcessed(
  shopifyWebhookId: string,
): Promise<boolean> {
  const existing = await prisma.webhookEvent.findUnique({
    where: { shopifyWebhookId },
    select: { id: true },
  });
  return existing !== null;
}

export async function recordWebhookEvent(
  input: RecordWebhookEventInput,
): Promise<boolean> {
  try {
    await prisma.webhookEvent.create({
      data: {
        shopifyWebhookId: input.shopifyWebhookId,
        shopDomain: input.shopDomain,
        topic: input.topic,
        shopId: input.shopId ?? null,
      },
    });
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return false;
    }
    throw error;
  }
}
