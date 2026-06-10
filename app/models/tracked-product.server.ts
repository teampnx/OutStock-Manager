import type {
  InventoryStatus,
  Prisma,
  TrackedProduct,
  TriggerSource,
} from "@prisma/client";

import prisma from "../db.server";
import {
  fetchProductInventorySnapshot,
  type ShopifyProductInventorySnapshot,
} from "../services/shopify-product-inventory.server";
import {
  getProductInventoryStatus as evaluateInventoryStatus,
  inventoryStatusToSoldOutFlag,
} from "../services/sold-out-detector.server";
import { ensureShop } from "./shop.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ProductInventoryStatusResult = {
  status: InventoryStatus;
  snapshot: ShopifyProductInventorySnapshot;
};

export type SyncProductInventoryInput = {
  shopDomain: string;
  shopifyProductId: string;
  admin: AdminGraphql;
  triggerSource: TriggerSource;
  shopifyWebhookId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

function trackedProductToInventoryStatus(
  product: TrackedProduct | null,
): InventoryStatus {
  if (!product) {
    return "UNKNOWN";
  }
  if (!product.tracksInventory) {
    return "UNKNOWN";
  }
  return product.isSoldOut ? "SOLD_OUT" : "IN_STOCK";
}

export async function getProductInventoryStatus(
  admin: AdminGraphql,
  shopifyProductId: string,
): Promise<ProductInventoryStatusResult | null> {
  const snapshot = await fetchProductInventorySnapshot(admin, shopifyProductId);
  if (!snapshot) {
    return null;
  }

  return {
    status: evaluateInventoryStatus(snapshot.inventory),
    snapshot,
  };
}

export async function syncProductInventory(
  input: SyncProductInventoryInput,
): Promise<TrackedProduct | null> {
  const evaluation = await getProductInventoryStatus(
    input.admin,
    input.shopifyProductId,
  );

  if (!evaluation) {
    return null;
  }

  const shop = await ensureShop(input.shopDomain);
  const { snapshot, status: newStatus } = evaluation;
  const now = new Date();

  const existing = await prisma.trackedProduct.findUnique({
    where: {
      shopId_shopifyProductId: {
        shopId: shop.id,
        shopifyProductId: snapshot.shopifyProductId,
      },
    },
  });

  const previousStatus = trackedProductToInventoryStatus(existing);
  const isSoldOut = inventoryStatusToSoldOutFlag(newStatus);
  const statusChanged = previousStatus !== newStatus;

  let soldOutAt = existing?.soldOutAt ?? null;
  let backInStockAt = existing?.backInStockAt ?? null;

  if (statusChanged) {
    if (newStatus === "SOLD_OUT") {
      soldOutAt = now;
    }
    if (newStatus === "IN_STOCK") {
      backInStockAt = now;
    }
  } else if (!existing) {
    if (isSoldOut) {
      soldOutAt = now;
    } else if (newStatus === "IN_STOCK") {
      backInStockAt = now;
    }
  }

  const lastStatusChangeAt = statusChanged
    ? now
    : (existing?.lastStatusChangeAt ?? (existing ? null : now));

  const trackedProduct = await prisma.trackedProduct.upsert({
    where: {
      shopId_shopifyProductId: {
        shopId: shop.id,
        shopifyProductId: snapshot.shopifyProductId,
      },
    },
    create: {
      shopId: shop.id,
      shopifyProductId: snapshot.shopifyProductId,
      title: snapshot.title,
      status: snapshot.status,
      tracksInventory: snapshot.tracksInventory,
      inventoryPolicy: snapshot.inventoryPolicy,
      totalAvailable: snapshot.totalAvailable,
      isSoldOut,
      soldOutAt: isSoldOut ? now : null,
      backInStockAt: !isSoldOut ? now : null,
      lastStatusChangeAt: now,
      lastWebhookAt: now,
    },
    update: {
      title: snapshot.title,
      status: snapshot.status,
      tracksInventory: snapshot.tracksInventory,
      inventoryPolicy: snapshot.inventoryPolicy,
      totalAvailable: snapshot.totalAvailable,
      isSoldOut,
      soldOutAt,
      backInStockAt,
      lastStatusChangeAt,
      lastWebhookAt: now,
    },
  });

  if (statusChanged) {
    await prisma.inventoryStatusHistory.create({
      data: {
        shopId: shop.id,
        trackedProductId: trackedProduct.id,
        previousStatus,
        newStatus,
        totalAvailable: snapshot.totalAvailable,
        triggerSource: input.triggerSource,
        shopifyWebhookId: input.shopifyWebhookId ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  }

  return trackedProduct;
}

export type TrackedProductListItem = {
  id: string;
  shopifyProductId: string;
  title: string | null;
  totalAvailable: number;
  inventoryPolicy: string;
  status: InventoryStatus;
  lastStatusChangeAt: string | null;
};

export async function listTrackedProductsForShop(
  shopDomain: string,
): Promise<TrackedProductListItem[]> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return [];
  }

  const products = await prisma.trackedProduct.findMany({
    where: { shopId: shop.id },
    orderBy: [{ lastStatusChangeAt: "desc" }, { updatedAt: "desc" }],
  });

  return products.map((product) => ({
    id: product.id,
    shopifyProductId: product.shopifyProductId,
    title: product.title,
    totalAvailable: product.totalAvailable,
    inventoryPolicy: product.inventoryPolicy,
    status: trackedProductToInventoryStatus(product),
    lastStatusChangeAt: product.lastStatusChangeAt?.toISOString() ?? null,
  }));
}
