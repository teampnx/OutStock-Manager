import type { LoaderFunctionArgs } from "react-router";

import {
  enforcePlanForShop,
  getPlanUsage,
  type PlanUsage,
} from "../lib/plan-enforcement.server";
import { syncShopBillingFromShopify } from "../models/billing.server";
import { authenticate } from "../shopify.server";

/**
 * Syncs Shopify subscription state and returns current plan usage.
 * Call from route loaders that need up-to-date plan limits.
 */
export async function loadPlanEnforcementContext(
  request: Request,
): Promise<PlanUsage> {
  const { billing, session } = await authenticate.admin(request);
  await syncShopBillingFromShopify(session.shop, billing);
  return enforcePlanForShop(session.shop);
}

export async function withPlanEnforcement(
  request: Request,
  handler: (usage: PlanUsage) => Promise<Response> | Response,
) {
  const usage = await loadPlanEnforcementContext(request);
  return handler(usage);
}

export async function getPlanUsageForRequest(
  args: LoaderFunctionArgs,
): Promise<PlanUsage> {
  return loadPlanEnforcementContext(args.request);
}
