import type { PlanId } from "./pricing-plans";

/** Keys must match entries in shopifyApp({ billing }). */
export const BILLING_PLAN_GROWTH = "GROWTH" as const;
export const BILLING_PLAN_PRO = "PRO" as const;

export type BillingPlanKey = typeof BILLING_PLAN_GROWTH | typeof BILLING_PLAN_PRO;

/** Mirrors shopifyApp({ billing }) line items — used for logging and diagnostics. */
export const BILLING_PLAN_LINE_ITEMS: Record<
  BillingPlanKey,
  { amount: number; currencyCode: "USD"; interval: "Every30Days" }
> = {
  [BILLING_PLAN_GROWTH]: {
    amount: 9.99,
    currencyCode: "USD",
    interval: "Every30Days",
  },
  [BILLING_PLAN_PRO]: {
    amount: 19.99,
    currencyCode: "USD",
    interval: "Every30Days",
  },
};

export const PAID_BILLING_PLAN_KEYS: BillingPlanKey[] = [
  BILLING_PLAN_GROWTH,
  BILLING_PLAN_PRO,
];

export function isBillingTestMode(): boolean {
  const flag = process.env.SHOPIFY_BILLING_TEST;
  if (flag === "false") {
    return false;
  }
  return true;
}

export function billingPlanKeyToPlanId(planKey: string): PlanId | null {
  if (planKey === BILLING_PLAN_GROWTH) {
    return "GROWTH";
  }
  if (planKey === BILLING_PLAN_PRO) {
    return "PRO";
  }
  return null;
}

export function planIdToBillingPlanKey(planId: PlanId): BillingPlanKey | null {
  if (planId === "GROWTH") {
    return BILLING_PLAN_GROWTH;
  }
  if (planId === "PRO") {
    return BILLING_PLAN_PRO;
  }
  return null;
}

export function billingCallbackUrl(planId: PlanId): string {
  const appUrl = process.env.SHOPIFY_APP_URL ?? "";
  return `${appUrl}/app/billing/callback?plan=${planId}`;
}
