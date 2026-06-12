import type { Plan, SubscriptionStatus } from "@prisma/client";
import type { BillingCheckResponseObject } from "@shopify/shopify-api";

import {
  billingPlanKeyToPlanId,
  isBillingTestMode,
  PAID_BILLING_PLAN_KEYS,
  type BillingPlanKey,
} from "../lib/billing-config";
import {
  isAuthRedirectResponse,
  logBillingError,
} from "../lib/billing-errors.server";
import { planFromDatabase } from "../lib/plan-enforcement.server";
import type { PlanId } from "../lib/pricing-plans";
import prisma from "../db.server";
import type { authenticate } from "../shopify.server";
import { ensureShop, updateShopPlan } from "./shop.server";

type BillingContext = Awaited<
  ReturnType<typeof authenticate.admin>
>["billing"];

export type ShopBillingSnapshot = {
  plan: PlanId;
  subscriptionStatus: SubscriptionStatus | null;
  shopifySubscriptionId: string | null;
  isTest: boolean;
  currentPeriodEnd: string | null;
  hasActivePayment: boolean;
};

function mapShopifyStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "PENDING":
      return "PENDING";
    case "ACTIVE":
    case "ACCEPTED":
      return "ACTIVE";
    case "CANCELLED":
      return "CANCELLED";
    case "DECLINED":
      return "DECLINED";
    case "EXPIRED":
      return "EXPIRED";
    case "FROZEN":
      return "FROZEN";
    default:
      return "PENDING";
  }
}

function resolvePlanFromBillingCheck(
  billingCheck: BillingCheckResponseObject,
): PlanId {
  if (!billingCheck.hasActivePayment) {
    return "FREE";
  }

  for (const subscription of billingCheck.appSubscriptions) {
    const planId = billingPlanKeyToPlanId(subscription.name);
    if (planId && subscription.status === "ACTIVE") {
      return planId;
    }
  }

  for (const subscription of billingCheck.appSubscriptions) {
    const planId = billingPlanKeyToPlanId(subscription.name);
    if (planId) {
      return planId;
    }
  }

  return "FREE";
}

function pickActiveSubscription(billingCheck: BillingCheckResponseObject) {
  const subscriptions = billingCheck.appSubscriptions ?? [];
  return (
    subscriptions.find((subscription) => subscription.status === "ACTIVE") ??
    subscriptions[0]
  );
}

function freeBillingSnapshot(isTest = isBillingTestMode()): ShopBillingSnapshot {
  return {
    plan: "FREE",
    subscriptionStatus: "CANCELLED",
    shopifySubscriptionId: null,
    isTest,
    currentPeriodEnd: null,
    hasActivePayment: false,
  };
}

async function persistFreeBillingState(
  shopId: string,
  isTest: boolean,
): Promise<ShopBillingSnapshot> {
  await prisma.subscription.upsert({
    where: { shopId },
    create: {
      shopId,
      plan: "FREE",
      status: "CANCELLED",
      isTest,
      shopifySubscriptionId: null,
      currentPeriodEnd: null,
    },
    update: {
      plan: "FREE",
      status: "CANCELLED",
      isTest,
      shopifySubscriptionId: null,
      currentPeriodEnd: null,
    },
  });

  return freeBillingSnapshot(isTest);
}

export async function syncShopBillingFromShopify(
  shopDomain: string,
  billing: BillingContext,
): Promise<ShopBillingSnapshot> {
  console.error(`[pricing] STEP START syncShopBillingFromShopify.inner shop=${shopDomain}`);
  const shop = await ensureShop(shopDomain);
  const isTest = isBillingTestMode();

  let billingCheck: BillingCheckResponseObject;
  try {
    console.error(
      `[pricing] STEP START billing.check shop=${shopDomain} isTest=${isTest} plans=${PAID_BILLING_PLAN_KEYS.join(",")}`,
    );
    billingCheck = await billing.check({
      plans: PAID_BILLING_PLAN_KEYS,
      isTest,
    });
    console.error(
      `[pricing] STEP OK billing.check shop=${shopDomain}`,
      JSON.stringify({
        hasActivePayment: billingCheck.hasActivePayment,
        subscriptionCount: billingCheck.appSubscriptions?.length ?? 0,
        subscriptions: (billingCheck.appSubscriptions ?? []).map((subscription) => ({
          name: subscription.name,
          status: subscription.status,
          test: subscription.test,
        })),
      }),
    );
  } catch (error) {
    console.error(
      `[pricing] STEP FAIL billing.check shop=${shopDomain}`,
      error instanceof Error ? error.message : String(error),
    );
    if (error instanceof Error && error.stack) {
      console.error(`[pricing] billing.check stack shop=${shopDomain}:`, error.stack);
    }
    if (isAuthRedirectResponse(error)) {
      throw error;
    }

    logBillingError("billing.check", shopDomain, error);
    throw error;
  }

  const plan = resolvePlanFromBillingCheck(billingCheck);
  const activeSubscription = pickActiveSubscription(billingCheck);

  try {
    await updateShopPlan(shopDomain, plan as Plan);
  } catch (error) {
    logBillingError("updateShopPlan", shopDomain, error);
    return getShopBillingSnapshot(shopDomain);
  }

  if (!billingCheck.hasActivePayment || !activeSubscription) {
    return persistFreeBillingState(shop.id, isTest);
  }

  const status = mapShopifyStatus(activeSubscription.status);
  const currentPeriodEnd = activeSubscription.currentPeriodEnd
    ? new Date(activeSubscription.currentPeriodEnd)
    : null;

  try {
    await prisma.subscription.upsert({
      where: { shopId: shop.id },
      create: {
        shopId: shop.id,
        plan: plan as Plan,
        status,
        isTest: activeSubscription.test,
        shopifySubscriptionId: activeSubscription.id,
        currentPeriodEnd,
      },
      update: {
        plan: plan as Plan,
        status,
        isTest: activeSubscription.test,
        shopifySubscriptionId: activeSubscription.id,
        currentPeriodEnd,
      },
    });
  } catch (error) {
    logBillingError("subscription.upsert", shopDomain, error);
    return {
      plan,
      subscriptionStatus: status,
      shopifySubscriptionId: activeSubscription.id,
      isTest: activeSubscription.test,
      currentPeriodEnd: activeSubscription.currentPeriodEnd ?? null,
      hasActivePayment: billingCheck.hasActivePayment,
    };
  }

  return {
    plan,
    subscriptionStatus: status,
    shopifySubscriptionId: activeSubscription.id,
    isTest: activeSubscription.test,
    currentPeriodEnd: activeSubscription.currentPeriodEnd ?? null,
    hasActivePayment: billingCheck.hasActivePayment,
  };
}

/** DB-backed subscription snapshot (pricing loader: getCurrentSubscription). */
export async function getCurrentSubscription(
  shopDomain: string,
): Promise<ShopBillingSnapshot> {
  return getShopBillingSnapshot(shopDomain);
}

export async function getShopBillingSnapshot(
  shopDomain: string,
): Promise<ShopBillingSnapshot> {
  const shop = await ensureShop(shopDomain);
  const subscription = await prisma.subscription.findUnique({
    where: { shopId: shop.id },
  });

  const plan = planFromDatabase(shop.plan);

  return {
    plan,
    subscriptionStatus: subscription?.status ?? null,
    shopifySubscriptionId: subscription?.shopifySubscriptionId ?? null,
    isTest: subscription?.isTest ?? isBillingTestMode(),
    currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
    hasActivePayment: plan !== "FREE",
  };
}

export async function cancelActiveSubscription(
  shopDomain: string,
  billing: BillingContext,
): Promise<void> {
  const shop = await ensureShop(shopDomain);
  const subscription = await prisma.subscription.findUnique({
    where: { shopId: shop.id },
  });

  if (subscription?.shopifySubscriptionId) {
    await billing.cancel({
      subscriptionId: subscription.shopifySubscriptionId,
      isTest: isBillingTestMode(),
      prorate: true,
    });
  }

  await syncShopBillingFromShopify(shopDomain, billing);
}

export function isPaidBillingPlanKey(
  value: string,
): value is BillingPlanKey {
  return value === "GROWTH" || value === "PRO";
}

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query CurrentAppInstallationBilling {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        currentPeriodEnd
      }
    }
  }
`;

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export async function syncShopBillingFromAdmin(
  shopDomain: string,
  admin: AdminGraphql,
): Promise<ShopBillingSnapshot> {
  const shop = await ensureShop(shopDomain);
  const response = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
  const json = await response.json();
  const subscriptions =
    json.data?.currentAppInstallation?.activeSubscriptions ?? [];

  const activeSubscription =
    subscriptions.find(
      (subscription: { status: string }) => subscription.status === "ACTIVE",
    ) ?? subscriptions[0];

  if (!activeSubscription) {
    await updateShopPlan(shopDomain, "FREE");
    await prisma.subscription.upsert({
      where: { shopId: shop.id },
      create: {
        shopId: shop.id,
        plan: "FREE",
        status: "CANCELLED",
        isTest: isBillingTestMode(),
        shopifySubscriptionId: null,
        currentPeriodEnd: null,
      },
      update: {
        plan: "FREE",
        status: "CANCELLED",
        isTest: isBillingTestMode(),
        shopifySubscriptionId: null,
        currentPeriodEnd: null,
      },
    });

    return {
      plan: "FREE",
      subscriptionStatus: "CANCELLED",
      shopifySubscriptionId: null,
      isTest: isBillingTestMode(),
      currentPeriodEnd: null,
      hasActivePayment: false,
    };
  }

  const planId = billingPlanKeyToPlanId(activeSubscription.name) ?? "FREE";
  const status = mapShopifyStatus(activeSubscription.status);
  const currentPeriodEnd = activeSubscription.currentPeriodEnd
    ? new Date(activeSubscription.currentPeriodEnd)
    : null;

  await updateShopPlan(shopDomain, planId as Plan);
  await prisma.subscription.upsert({
    where: { shopId: shop.id },
    create: {
      shopId: shop.id,
      plan: planId as Plan,
      status,
      isTest: activeSubscription.test,
      shopifySubscriptionId: activeSubscription.id,
      currentPeriodEnd,
    },
    update: {
      plan: planId as Plan,
      status,
      isTest: activeSubscription.test,
      shopifySubscriptionId: activeSubscription.id,
      currentPeriodEnd,
    },
  });

  return {
    plan: planId,
    subscriptionStatus: status,
    shopifySubscriptionId: activeSubscription.id,
    isTest: activeSubscription.test,
    currentPeriodEnd: activeSubscription.currentPeriodEnd ?? null,
    hasActivePayment: planId !== "FREE",
  };
}
