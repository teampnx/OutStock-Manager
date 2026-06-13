import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  APP_NAME,
  pageTitle,
} from "../lib/branding";
import {
  BILLING_PLAN_LINE_ITEMS,
  billingCallbackUrl,
  isBillingTestMode,
  planIdToBillingPlanKey,
  type BillingPlanKey,
} from "../lib/billing-config";
import {
  PRICING_FAQ,
  UPGRADE_BENEFITS,
  type UpgradeBenefit,
} from "../lib/pricing-content";
import {
  FEATURE_COMPARISON,
  formatPlanLimit,
  getPlanDefinition,
  isPlanDowngrade,
  isPlanUpgrade,
  PRICING_PLANS,
  type PlanId,
  usagePercent,
} from "../lib/pricing-plans";
import { getDashboardStats } from "../models/activity-log.server";
import {
  cancelActiveSubscription,
  getCurrentSubscription,
  getShopBillingSnapshot,
  syncShopBillingFromShopify,
  type ShopBillingSnapshot,
} from "../models/billing.server";
import {
  formatBillingError,
  isAuthRedirectResponse,
  logBillingRequestFailure,
  logBillingRequestStart,
} from "../lib/billing-errors.server";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";

export function meta() {
  return [{ title: pageTitle("Pricing") }];
}

function logPricingStepFailure(step: string, shop: string, error: unknown): void {
  console.error(
    `[pricing] STEP FAIL ${step} shop=${shop}`,
    error instanceof Error ? error.message : String(error),
  );
  if (error instanceof Error && error.stack) {
    console.error(`[pricing] STACK ${step} shop=${shop}:`, error.stack);
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shopDomain = "unknown";

  const url = new URL(request.url);
  const billingConfirmed = url.searchParams.get("billing") === "confirmed";

  let stats = {
    totalTrackedProducts: 0,
    totalTrackedCollections: 0,
  };

  try {
    console.error("[pricing] STEP START authenticate.admin");
    const { session, billing } = await authenticate.admin(request);
    shopDomain = session.shop;
    console.error(`[pricing] STEP OK authenticate.admin shop=${shopDomain}`);

    console.error(`[pricing] STEP START ensureShop shop=${shopDomain}`);
    const shop = await ensureShop(session.shop);
    console.error(
      `[pricing] STEP OK ensureShop shop=${shopDomain} shopId=${shop.id} plan=${shop.plan}`,
    );

    console.error(`[pricing] STEP START getCurrentSubscription shop=${shopDomain}`);
    const currentSubscription = await getCurrentSubscription(session.shop);
    console.error(
      `[pricing] STEP OK getCurrentSubscription shop=${shopDomain}`,
      JSON.stringify(currentSubscription),
    );

    console.error(`[pricing] STEP START syncShopBillingFromShopify shop=${shopDomain}`);
    const billingSnapshot = await syncShopBillingFromShopify(session.shop, billing);
    console.error(
      `[pricing] STEP OK syncShopBillingFromShopify shop=${shopDomain}`,
      JSON.stringify(billingSnapshot),
    );

    console.error(`[pricing] STEP START usage calculation shop=${shopDomain}`);
    const dashboardStats = await getDashboardStats(session.shop, shop.id);
    stats = {
      totalTrackedProducts: dashboardStats.totalTrackedProducts,
      totalTrackedCollections: dashboardStats.totalTrackedCollections,
    };
    console.error(
      `[pricing] STEP OK usage calculation shop=${shopDomain}`,
      JSON.stringify(stats),
    );

    return {
      shopName: shop.shopName ?? shop.shopDomain,
      plan: billingSnapshot.plan,
      billing: billingSnapshot,
      billingTestMode: isBillingTestMode(),
      billingConfirmed,
      stats,
      billingWarning: null,
      error: null,
    };
  } catch (error) {
    if (isAuthRedirectResponse(error)) {
      console.error(
        `[pricing] STEP REDIRECT authenticate/admin shop=${shopDomain} status=${error.status}`,
      );
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pricing] LOADER CAUGHT EXCEPTION shop=${shopDomain}: ${message}`);
    logPricingStepFailure("loader", shopDomain, error);

    let billingSnapshot: ShopBillingSnapshot = {
      plan: "FREE",
      subscriptionStatus: null,
      shopifySubscriptionId: null,
      isTest: isBillingTestMode(),
      currentPeriodEnd: null,
      hasActivePayment: false,
    };

    try {
      billingSnapshot = await getShopBillingSnapshot(shopDomain);
    } catch (snapshotError) {
      logPricingStepFailure("getShopBillingSnapshot.fallback", shopDomain, snapshotError);
    }

    return {
      shopName: shopDomain,
      plan: billingSnapshot.plan,
      billing: billingSnapshot,
      billingTestMode: isBillingTestMode(),
      billingConfirmed,
      stats,
      billingWarning: null,
      error: message,
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const targetPlan = String(formData.get("plan") ?? "") as PlanId;

  if (intent === "change-plan") {
    if (targetPlan === "FREE") {
      try {
        await cancelActiveSubscription(session.shop, billing);
        return { success: true as const, message: "Downgraded to Free plan." };
      } catch (error) {
        console.error(
          `[pricing] Failed to downgrade ${session.shop} to Free:`,
          error,
        );
        return {
          success: false as const,
          error: "Could not cancel your subscription. Please try again.",
        };
      }
    }

    const billingPlanKey = planIdToBillingPlanKey(targetPlan);
    if (!billingPlanKey) {
      return { success: false as const, error: "Invalid plan selected." };
    }

    const lineItem = BILLING_PLAN_LINE_ITEMS[billingPlanKey as BillingPlanKey];
    const isTest = isBillingTestMode();
    const returnUrl = billingCallbackUrl(targetPlan);
    const appUrl = process.env.SHOPIFY_APP_URL ?? "";

    logBillingRequestStart(session.shop, {
      plan: billingPlanKey,
      amount: lineItem.amount,
      currencyCode: lineItem.currencyCode,
      interval: lineItem.interval,
      isTest,
      returnUrl,
      appUrl,
    });

    try {
      return await billing.request({
        plan: billingPlanKey,
        isTest,
        returnUrl,
      });
    } catch (error) {
      if (isAuthRedirectResponse(error)) {
        throw error;
      }

      logBillingRequestFailure(session.shop, error);

      const shopifyMessage = formatBillingError(error);
      const isPublicDistributionError = shopifyMessage.includes(
        "public distribution",
      );

      return {
        success: false as const,
        error: isPublicDistributionError
          ? `${shopifyMessage} Enable public (Shopify App Store) distribution for this app in Shopify Partners → Apps → ${APP_NAME} → Distribution. The app can remain in draft; it does not need to be published.`
          : shopifyMessage || "Billing request failed.",
      };
    }
  }

  if (intent === "sync-billing") {
    try {
      await syncShopBillingFromShopify(session.shop, billing);
      return { success: true as const, message: "Subscription status updated." };
    } catch (error) {
      console.error(`[pricing] Failed to sync billing for ${session.shop}:`, error);
      return {
        success: false as const,
        error: "Could not refresh subscription status.",
      };
    }
  }

  return { success: false as const, error: "Unknown action." };
};

function planBadgeTone(planId: PlanId) {
  switch (planId) {
    case "PRO":
      return "success" as const;
    case "GROWTH":
      return "info" as const;
    default:
      return "auto" as const;
  }
}

function subscriptionStatusLabel(
  status: ShopBillingSnapshot["subscriptionStatus"],
): string {
  if (!status) {
    return "No active subscription";
  }
  return status.charAt(0) + status.slice(1).toLowerCase();
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

function benefitIcon(type: UpgradeBenefit["icon"]) {
  switch (type) {
    case "automation":
      return "automation" as const;
    case "analytics":
      return "chart-horizontal" as const;
    case "support":
      return "chat" as const;
    case "scale":
      return "product-add" as const;
    default:
      return "check-circle" as const;
  }
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
  const navigation = useNavigation();
  const isCurrent = plan.id === currentPlanId;
  const isUpgrade = isPlanUpgrade(currentPlanId, plan.id);
  const isDowngrade = isPlanDowngrade(currentPlanId, plan.id);
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("plan") === plan.id;

  return (
    <div
      className={
        isCurrent
          ? "pricing-plan-card-current"
          : plan.id === "PRO"
            ? "pricing-plan-card-pro"
            : undefined
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
              {plan.id === "PRO" && !isCurrent ? (
                <span className="pricing-plan-badge-pro">Best value</span>
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
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="change-plan" />
              <input type="hidden" name="plan" value={plan.id} />
              <s-button
                type="submit"
                variant={plan.id === "PRO" || isUpgrade ? "primary" : "secondary"}
                {...(isSubmitting ? { loading: true } : {})}
                disabled={isSubmitting}
              >
                {isDowngrade ? plan.ctaLabel : plan.ctaLabel}
              </s-button>
            </Form>
          )}
        </s-stack>
      </s-box>
    </div>
  );
}

export default function PricingPage() {
  const {
    shopName,
    plan,
    billing,
    billingTestMode,
    billingConfirmed,
    billingWarning,
    stats,
    error,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const currentPlan = getPlanDefinition(plan);

  return (
    <s-page heading="Pricing" inlineSize="large">
      <s-link slot="primary-action" href="/app/settings">
        Settings
      </s-link>

      {billingWarning ? (
        <s-banner tone="warning" heading="Billing status unavailable">
          <s-paragraph>{billingWarning}</s-paragraph>
        </s-banner>
      ) : null}

      {error ? (
        <s-banner tone="critical" heading="Unable to load pricing">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      ) : null}

      {actionData?.success === false && actionData.error ? (
        <s-banner tone="critical" heading="Billing action failed">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-banner>
      ) : null}

      {actionData?.success === true && actionData.message ? (
        <s-banner tone="success" heading="Billing updated">
          <s-paragraph>{actionData.message}</s-paragraph>
        </s-banner>
      ) : null}

      {billingConfirmed ? (
        <s-banner tone="success" heading="Subscription approved">
          <s-paragraph>
            Your plan change was approved by Shopify. Your current plan is now{" "}
            {currentPlan.name}.
          </s-paragraph>
        </s-banner>
      ) : null}

      <s-stack direction="block" gap="large">
        <div className="pricing-page-intro">
          <s-stack direction="block" gap="small-200">
            <p className="page-intro-title">Plans for every catalog size</p>
            <p className="page-intro-text">
              Scale collection sorting, pinning, and automation as your store
              grows. Your current plan is highlighted below.
            </p>
          </s-stack>
        </div>

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
                {billingTestMode ? (
                  <s-badge tone="warning">Test billing</s-badge>
                ) : null}
              </s-stack>
              <s-paragraph>
                <s-text color="subdued">
                  {shopName} is on the {currentPlan.name} plan.
                  {billing.hasActivePayment
                    ? ` Subscription status: ${subscriptionStatusLabel(billing.subscriptionStatus)}.`
                    : " No paid subscription is active."}
                </s-text>
              </s-paragraph>
              {billing.currentPeriodEnd ? (
                <s-paragraph>
                  <s-text color="subdued">
                    Current period ends{" "}
                    {new Date(billing.currentPeriodEnd).toLocaleDateString()}.
                  </s-text>
                </s-paragraph>
              ) : null}
            </s-stack>
            <s-stack direction="block" gap="small-100" alignItems="end">
              <p className="pricing-plan-price">{currentPlan.price}</p>
              <p className="pricing-plan-price-detail">
                {currentPlan.priceDetail}
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="sync-billing" />
                <s-button type="submit" variant="tertiary">
                  Refresh status
                </s-button>
              </Form>
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
              Choose a plan to upgrade or downgrade. Paid plans open Shopify&apos;s
              billing approval page to confirm your subscription.
            </s-text>
          </s-paragraph>
          <div className="curatify-pricing-grid">
            {PRICING_PLANS.map((planOption) => (
              <PlanCard
                key={planOption.id}
                plan={planOption}
                currentPlanId={plan}
              />
            ))}
          </div>
        </s-stack>

        <s-box
          padding="none"
          borderWidth="base"
          borderRadius="large"
          background="base"
        >
          <s-box padding="base" background="subdued">
            <s-text type="strong">Why upgrade?</s-text>
          </s-box>
          <s-box padding="base">
            <div className="pricing-benefits-grid">
              {UPGRADE_BENEFITS.map((benefit) => (
                <div key={benefit.title} className="pricing-benefit-card">
                  <s-stack direction="inline" gap="small-100" alignItems="start">
                    <s-icon type={benefitIcon(benefit.icon)} tone="info" />
                    <div>
                      <p className="benefit-card-title">{benefit.title}</p>
                      <p className="benefit-card-text">{benefit.description}</p>
                    </div>
                  </s-stack>
                </div>
              ))}
            </div>
          </s-box>
        </s-box>

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
                    <th scope="col">Growth</th>
                    <th scope="col">Pro</th>
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_COMPARISON.map((row) => (
                    <tr key={row.feature}>
                      <th scope="row">{row.feature}</th>
                      <td>{row.free}</td>
                      <td>{row.growth}</td>
                      <td>{row.pro}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </s-box>
        </s-box>

        <s-box
          padding="none"
          borderWidth="base"
          borderRadius="large"
          background="base"
        >
          <s-box padding="base" background="subdued">
            <s-text type="strong">Frequently asked questions</s-text>
          </s-box>
          <div className="pricing-faq-list">
            {PRICING_FAQ.map((item) => (
              <div key={item.question} className="pricing-faq-item faq-item">
                <p className="faq-question">{item.question}</p>
                <p className="faq-answer">{item.answer}</p>
              </div>
            ))}
          </div>
        </s-box>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
