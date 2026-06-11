export type PlanId = "FREE" | "STARTER" | "PRO";

export type PlanDefinition = {
  id: PlanId;
  name: string;
  price: string;
  priceDetail: string;
  description: string;
  limits: {
    products: number | null;
    collections: number | null;
  };
  ctaLabel: string;
};

export type FeatureComparisonRow = {
  feature: string;
  free: string;
  starter: string;
  pro: string;
};

export const PRICING_PLANS: PlanDefinition[] = [
  {
    id: "FREE",
    name: "Free",
    price: "$0",
    priceDetail: "per month",
    description: "Get started with sold-out sorting for small catalogs.",
    limits: { products: 50, collections: 5 },
    ctaLabel: "Downgrade to Free",
  },
  {
    id: "STARTER",
    name: "Starter",
    price: "$9",
    priceDetail: "per month",
    description: "For growing stores that need reliable automated sorting.",
    limits: { products: 500, collections: 25 },
    ctaLabel: "Upgrade to Starter",
  },
  {
    id: "PRO",
    name: "Pro",
    price: "$29",
    priceDetail: "per month",
    description: "Advanced automation and higher limits for busy stores.",
    limits: { products: null, collections: null },
    ctaLabel: "Upgrade to Pro",
  },
];

export const FEATURE_COMPARISON: FeatureComparisonRow[] = [
  {
    feature: "Products tracked",
    free: "50",
    starter: "500",
    pro: "Unlimited",
  },
  {
    feature: "Collections managed",
    free: "5",
    starter: "25",
    pro: "Unlimited",
  },
  {
    feature: "Push sold-out to bottom",
    free: "Yes",
    starter: "Yes",
    pro: "Yes",
  },
  {
    feature: "Restore when back in stock",
    free: "Yes",
    starter: "Yes",
    pro: "Yes",
  },
  {
    feature: "Activity log",
    free: "7 days",
    starter: "30 days",
    pro: "90 days",
  },
  {
    feature: "Collection sync",
    free: "Manual",
    starter: "Automatic",
    pro: "Automatic",
  },
  {
    feature: "Priority support",
    free: "—",
    starter: "Email",
    pro: "Priority",
  },
];

export function getPlanDefinition(planId: PlanId): PlanDefinition {
  return PRICING_PLANS.find((plan) => plan.id === planId) ?? PRICING_PLANS[0];
}

export function formatPlanLimit(limit: number | null): string {
  return limit == null ? "Unlimited" : limit.toLocaleString();
}

export function usagePercent(used: number, limit: number | null): number {
  if (limit == null || limit === 0) {
    return 0;
  }

  return Math.min(100, Math.round((used / limit) * 100));
}
