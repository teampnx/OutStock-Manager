import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  FEATURE_COMPARISON,
  formatPlanLimit,
  getPlanDefinition,
  PRICING_PLANS,
  type PlanId,
  usagePercent,
} from "../lib/pricing-plans";
import { getDashboardStats } from "../models/activity-log.server";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  let stats = {
    totalTrackedProducts: 0,
    totalTrackedCollections: 0,
  };

  try {
    const shop = await ensureShop(session.shop);

    try {
      const dashboardStats = await getDashboardStats(session.shop, shop.id);
      stats = {
        totalTrackedProducts: dashboardStats.totalTrackedProducts,
        totalTrackedCollections: dashboardStats.totalTrackedCollections,
      };
    } catch (statsError) {
      console.error(
        `[pricing] Failed to load usage for ${session.shop}:`,
        statsError,
      );
    }

    return {
      shopName: shop.shopName ?? shop.shopDomain,
      plan: shop.plan as PlanId,
      stats,
      error: null,
    };
  } catch (error) {
    console.error(`[pricing] Failed to load pricing for ${session.shop}:`, error);

    return {
      shopName: session.shop,
      plan: "FREE" as const,
      stats,
      error: "Could not load pricing information. Please refresh the page.",
    };
  }
};

function planBadgeTone(planId: PlanId) {
  switch (planId) {
    case "PRO":
      return "success" as const;
    case "STARTER":
      return "info" as const;
    default:
      return "auto" as const;
  }
}

function progressFillClass(percent: number) {
  if (percent >= 90) {
    return "pricing-progress-fill pricing-progress-fill-critical";
  }
  if (percent >= 75) {
    return "pricing-progress-fill pricing-progress-fill-warning";
  }
  return "pricing-progress-fill";
}

function UsageMeter({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number | null;
}) {
  const percent = usagePercent(used, limit);
  const limitLabel = formatPlanLimit(limit);

  return (
    <s-stack direction="block" gap="small-100">
      <s-grid gridTemplateColumns="1fr auto" gap="small" alignItems="baseline">
        <p className="pricing-usage-label">{label}</p>
        <p className="pricing-usage-value">
          {used.toLocaleString()} / {limitLabel}
        </p>
      </s-grid>
      {limit == null ? (
        <s-text color="subdued">Unlimited on your current plan</s-text>
      ) : (
        <div className="pricing-progress-track">
          <div
            className={progressFillClass(percent)}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </s-stack>
  );
}

function PlanCard({
  plan,
  currentPlanId,
}: {
  plan: (typeof PRICING_PLANS)[number];
  currentPlanId: PlanId;
}) {
  const isCurrent = plan.id === currentPlanId;
  const isUpgrade =
    (currentPlanId === "FREE" && plan.id !== "FREE") ||
    (currentPlanId === "STARTER" && plan.id === "PRO");

  return (
    <div
      className={
        plan.id === "STARTER" ? "pricing-plan-card-highlight" : undefined
      }
    >
      <s-box
        padding="large"
        borderWidth="base"
        borderRadius="large"
        background="base"
      >
        <s-stack direction="block" gap="base">
        <s-stack direction="block" gap="small-100">
          <s-stack direction="inline" gap="small-100" alignItems="center">
            <s-heading>{plan.name}</s-heading>
            {isCurrent ? <s-badge tone="success">Current plan</s-badge> : null}
            {plan.id === "STARTER" && !isCurrent ? (
              <s-badge tone="info">Popular</s-badge>
            ) : null}
          </s-stack>
          <s-paragraph>
            <s-text color="subdued">{plan.description}</s-text>
          </s-paragraph>
        </s-stack>

        <s-stack direction="block" gap="small-100">
          <p className="pricing-plan-price">{plan.price}</p>
          <p className="pricing-plan-price-detail">{plan.priceDetail}</p>
        </s-stack>

        <s-stack direction="block" gap="small-100">
          <s-text>
            <s-text type="strong">Products: </s-text>
            {formatPlanLimit(plan.limits.products)}
          </s-text>
          <s-text>
            <s-text type="strong">Collections: </s-text>
            {formatPlanLimit(plan.limits.collections)}
          </s-text>
        </s-stack>

        {isCurrent ? (
          <s-button disabled>Current plan</s-button>
        ) : isUpgrade ? (
          <s-button variant="primary">{plan.ctaLabel}</s-button>
        ) : (
          <s-button variant="secondary" disabled>
            {plan.ctaLabel}
          </s-button>
        )}
        </s-stack>
      </s-box>
    </div>
  );
}

export default function PricingPage() {
  const { shopName, plan, stats, error } = useLoaderData<typeof loader>();
  const currentPlan = getPlanDefinition(plan);

  return (
    <s-page heading="Pricing" inlineSize="large">
      <s-link slot="primary-action" href="/app/settings">
        Settings
      </s-link>

      {error && (
        <s-banner tone="critical" heading="Unable to load pricing">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      <s-stack direction="block" gap="large">
        <s-box
          padding="large"
          borderWidth="base"
          borderRadius="large"
          background="base"
        >
          <s-grid
            gridTemplateColumns="1fr auto"
            gap="base"
            alignItems="start"
          >
            <s-stack direction="block" gap="small-200">
              <s-stack direction="inline" gap="small-100" alignItems="center">
                <s-heading>Current plan</s-heading>
                <s-badge tone={planBadgeTone(plan)}>{currentPlan.name}</s-badge>
              </s-stack>
              <s-paragraph>
                <s-text color="subdued">
                  {shopName} is on the {currentPlan.name} plan. Upgrade anytime
                  when you need higher limits.
                </s-text>
              </s-paragraph>
              <s-paragraph>
                <s-text color="subdued">
                  Billing integration is coming soon. Upgrade buttons are
                  preview-only for now.
                </s-text>
              </s-paragraph>
            </s-stack>
            <s-stack direction="block" gap="small-100" alignItems="end">
              <p className="pricing-plan-price">{currentPlan.price}</p>
              <p className="pricing-plan-price-detail">
                {currentPlan.priceDetail}
              </p>
            </s-stack>
          </s-grid>
        </s-box>

        <s-box
          padding="none"
          borderWidth="base"
          borderRadius="large"
          background="base"
        >
          <s-box padding="base" background="subdued">
            <s-text type="strong">Usage</s-text>
          </s-box>
          <s-box padding="base">
            <s-grid gap="large" gridTemplateColumns="1fr 1fr">
              <UsageMeter
                label="Products tracked"
                used={stats.totalTrackedProducts}
                limit={currentPlan.limits.products}
              />
              <UsageMeter
                label="Collections managed"
                used={stats.totalTrackedCollections}
                limit={currentPlan.limits.collections}
              />
            </s-grid>
          </s-box>
        </s-box>

        <s-stack direction="block" gap="small-200">
          <s-heading>Plans</s-heading>
          <s-paragraph>
            <s-text color="subdued">
              Choose the plan that fits your catalog size and automation needs.
            </s-text>
          </s-paragraph>
          <s-grid gap="base" gridTemplateColumns="1fr 1fr 1fr">
            {PRICING_PLANS.map((planOption) => (
              <PlanCard
                key={planOption.id}
                plan={planOption}
                currentPlanId={plan}
              />
            ))}
          </s-grid>
        </s-stack>

        <s-box
          padding="none"
          borderWidth="base"
          borderRadius="large"
          background="base"
        >
          <s-box padding="base" background="subdued">
            <s-text type="strong">Feature comparison</s-text>
          </s-box>
          <s-box padding="base">
            <div className="pricing-comparison-scroll">
              <table className="pricing-comparison-table">
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    <th scope="col">Free</th>
                    <th scope="col">Starter</th>
                    <th scope="col">Pro</th>
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_COMPARISON.map((row) => (
                    <tr key={row.feature}>
                      <th scope="row">{row.feature}</th>
                      <td>{row.free}</td>
                      <td>{row.starter}</td>
                      <td>{row.pro}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </s-box>
        </s-box>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
