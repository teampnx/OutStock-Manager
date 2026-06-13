import type { PlanId } from "./pricing-plans";

/** Maximum pinned products per collection; `0` means pinning is unavailable. */
export function getPinnedProductLimitForPlan(plan: PlanId): number | null {
  switch (plan) {
    case "FREE":
      return 0;
    case "GROWTH":
      return 5;
    case "PRO":
      return null;
    default:
      return 0;
  }
}

export function isPinningAvailableForPlan(plan: PlanId): boolean {
  return getPinnedProductLimitForPlan(plan) !== 0;
}

export function formatPinnedProductLimit(plan: PlanId): string {
  const limit = getPinnedProductLimitForPlan(plan);
  if (limit === 0) {
    return "Unavailable on Free";
  }
  if (limit == null) {
    return "Unlimited";
  }
  return String(limit);
}
