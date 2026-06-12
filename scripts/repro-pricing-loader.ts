/**
 * Reproduces pricing loader steps without embedded auth.
 * Run: npx tsx scripts/repro-pricing-loader.ts
 */
import { PrismaClient } from "@prisma/client";

import { getDashboardStats } from "../app/models/activity-log.server";
import {
  getCurrentSubscription,
  syncShopBillingFromShopify,
} from "../app/models/billing.server";
import { ensureShop } from "../app/models/shop.server";

async function main() {
  const prisma = new PrismaClient();
  const sessionRow = await prisma.session.findFirst({
    orderBy: { expires: "desc" },
  });

  if (!sessionRow) {
    console.error("[repro] No session in database");
    process.exit(1);
  }

  const shopDomain = sessionRow.shop;
  console.error(`[repro] shop=${shopDomain}`);

  process.env.SHOPIFY_API_KEY ??= "5a10d65799a7a6002c0c76972a346567";
  process.env.SHOPIFY_API_SECRET ??= "repro-secret";
  process.env.SHOPIFY_APP_URL ??= "https://example.com";
  process.env.SCOPES ??= "read_products,read_inventory,write_products";

  await import("../app/shopify.server");
  const { PrismaSessionStorage } = await import(
    "@shopify/shopify-app-session-storage-prisma"
  );
  const { shopifyApi, ApiVersion, BillingInterval } = await import(
    "@shopify/shopify-api"
  );
  const { PAID_BILLING_PLAN_KEYS } = await import("../app/lib/billing-config");
  const { isBillingTestMode } = await import("../app/lib/billing-config");

  const storage = new PrismaSessionStorage(prisma);
  const session = await storage.loadSession(sessionRow.id);
  if (!session) {
    console.error("[repro] Could not load session");
    process.exit(1);
  }

  const api = shopifyApi({
    apiKey: process.env.SHOPIFY_API_KEY!,
    apiSecretKey: process.env.SHOPIFY_API_SECRET!,
    scopes: process.env.SCOPES!.split(","),
    hostName: new URL(process.env.SHOPIFY_APP_URL!).host,
    apiVersion: ApiVersion.October25,
    isEmbeddedApp: true,
    billing: {
      GROWTH: {
        lineItems: [
          {
            amount: 9.99,
            currencyCode: "USD",
            interval: BillingInterval.Every30Days,
          },
        ],
      },
      PRO: {
        lineItems: [
          {
            amount: 19.99,
            currencyCode: "USD",
            interval: BillingInterval.Every30Days,
          },
        ],
      },
    },
  });

  const billing = {
    check: async (options: { plans?: string[]; isTest?: boolean }) =>
      api.billing.check({
        session,
        plans: options.plans ?? PAID_BILLING_PLAN_KEYS,
        isTest: options.isTest ?? isBillingTestMode(),
        returnObject: true,
      }),
  };

  try {
    console.error("[pricing] STEP START ensureShop");
    const shop = await ensureShop(shopDomain);
    console.error(`[pricing] STEP OK ensureShop shopId=${shop.id} plan=${shop.plan}`);

    console.error("[pricing] STEP START getCurrentSubscription");
    const current = await getCurrentSubscription(shopDomain);
    console.error("[pricing] STEP OK getCurrentSubscription", JSON.stringify(current));

    console.error("[pricing] STEP START syncShopBillingFromShopify");
    const snapshot = await syncShopBillingFromShopify(shopDomain, billing as never);
    console.error("[pricing] STEP OK syncShopBillingFromShopify", JSON.stringify(snapshot));

    console.error("[pricing] STEP START usage calculation");
    const stats = await getDashboardStats(shopDomain, shop.id);
    console.error("[pricing] STEP OK usage calculation", JSON.stringify({
      totalTrackedProducts: stats.totalTrackedProducts,
      totalTrackedCollections: stats.totalTrackedCollections,
    }));

    console.error("[repro] ALL STEPS OK");
  } catch (error) {
    console.error(
      "[pricing] LOADER CAUGHT EXCEPTION:",
      error instanceof Error ? error.message : String(error),
    );
    if (error instanceof Error && error.stack) {
      console.error("[pricing] STACK:", error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
