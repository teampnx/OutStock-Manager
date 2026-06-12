import type { Plan } from "@prisma/client";

import prisma from "../db.server";
import { getPlanDefinition, type PlanId } from "./pricing-plans";
import { getShopByDomain } from "../models/shop.server";

export class PlanLimitError extends Error {
  readonly code = "PLAN_LIMIT_EXCEEDED";

  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

export type PlanUsage = {
  plan: PlanId;
  productsUsed: number;
  collectionsUsed: number;
  productsLimit: number | null;
  collectionsLimit: number | null;
};

export async function getPlanUsage(shopDomain: string): Promise<PlanUsage> {
  const shop = await getShopByDomain(shopDomain);
  if (!shop) {
    throw new Error(`Shop not found: ${shopDomain}`);
  }

  const plan = getPlanDefinition(shop.plan as PlanId);
  const [productsUsed, collectionsUsed] = await Promise.all([
    prisma.trackedProduct.count({ where: { shopId: shop.id } }),
    prisma.collection.count({ where: { shopId: shop.id, enabled: true } }),
  ]);

  return {
    plan: shop.plan as PlanId,
    productsUsed,
    collectionsUsed,
    productsLimit: plan.limits.products,
    collectionsLimit: plan.limits.collections,
  };
}

export async function assertWithinCollectionLimit(
  shopDomain: string,
  additionalEnabled = 1,
): Promise<void> {
  const usage = await getPlanUsage(shopDomain);
  const limit = usage.collectionsLimit;

  if (limit == null) {
    return;
  }

  if (usage.collectionsUsed + additionalEnabled > limit) {
    throw new PlanLimitError(
      `Your ${getPlanDefinition(usage.plan).name} plan allows up to ${limit} enabled collections. ` +
        `Upgrade on the Pricing page to enable more.`,
    );
  }
}

export async function assertWithinProductLimit(
  shopDomain: string,
  additionalProducts = 1,
): Promise<void> {
  const usage = await getPlanUsage(shopDomain);
  const limit = usage.productsLimit;

  if (limit == null) {
    return;
  }

  if (usage.productsUsed + additionalProducts > limit) {
    throw new PlanLimitError(
      `Your ${getPlanDefinition(usage.plan).name} plan allows up to ${limit} tracked products. ` +
        `Upgrade on the Pricing page to track more.`,
    );
  }
}

export async function enforcePlanForShop(shopDomain: string): Promise<PlanUsage> {
  return getPlanUsage(shopDomain);
}

export function planFromDatabase(plan: Plan): PlanId {
  if (plan === "GROWTH" || plan === "PRO") {
    return plan;
  }
  return "FREE";
}
