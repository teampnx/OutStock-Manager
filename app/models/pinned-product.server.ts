import type { AdminGraphql } from "./collection-sort-with-pins.server";
import {
  applyCollectionSortWithPins,
} from "./collection-sort-with-pins.server";
import prisma from "../db.server";
import {
  formatPinnedProductLimit,
  getPinnedProductLimitForPlan,
  isPinningAvailableForPlan,
} from "../lib/pinned-product-limits";
import { PlanLimitError } from "../lib/plan-enforcement.server";
import type { PlanId } from "../lib/pricing-plans";
import { toProductGid } from "../services/shopify-product-inventory.server";
import { ensureShop } from "./shop.server";

export class PinningNotAvailableError extends Error {
  readonly code = "PINNING_NOT_AVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "PinningNotAvailableError";
  }
}

export type PinnedProductItem = {
  id: string;
  shopifyProductId: string;
  position: number;
  title: string;
  isSoldOut: boolean;
};

export type PinningPlanContext = {
  plan: PlanId;
  pinningAvailable: boolean;
  limit: number | null;
  limitLabel: string;
  currentCount: number;
  atLimit: boolean;
};

async function getCollectionForShop(
  shopDomain: string,
  collectionId: string,
) {
  const shop = await ensureShop(shopDomain);
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, shopId: shop.id },
    select: {
      id: true,
      title: true,
      shopifyCollectionId: true,
      sortOrder: true,
    },
  });

  if (!collection) {
    return null;
  }

  return { shop, collection };
}

export async function getPinningPlanContext(
  shopDomain: string,
  collectionId: string,
): Promise<PinningPlanContext | null> {
  const shop = await ensureShop(shopDomain);
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, shopId: shop.id },
    select: { id: true },
  });

  if (!collection) {
    return null;
  }

  const plan = shop.plan as PlanId;
  const limit = getPinnedProductLimitForPlan(plan);
  const currentCount = await prisma.pinnedProduct.count({
    where: { collectionId },
  });

  return {
    plan,
    pinningAvailable: isPinningAvailableForPlan(plan),
    limit: limit === 0 ? 0 : limit,
    limitLabel: formatPinnedProductLimit(plan),
    currentCount,
    atLimit: limit != null && limit > 0 && currentCount >= limit,
  };
}

export async function listPinnedProductsForCollection(
  shopDomain: string,
  collectionId: string,
): Promise<PinnedProductItem[]> {
  const context = await getCollectionForShop(shopDomain, collectionId);
  if (!context) {
    return [];
  }

  const pins = await prisma.pinnedProduct.findMany({
    where: { collectionId },
    orderBy: { position: "asc" },
  });

  if (pins.length === 0) {
    return [];
  }

  const productGids = pins.map((pin) => toProductGid(pin.shopifyProductId));
  const tracked = await prisma.trackedProduct.findMany({
    where: {
      shopId: context.shop.id,
      shopifyProductId: { in: productGids },
    },
    select: {
      shopifyProductId: true,
      title: true,
      isSoldOut: true,
    },
  });

  const trackedByGid = new Map(
    tracked.map((row) => [row.shopifyProductId, row]),
  );

  return pins.map((pin) => {
    const gid = toProductGid(pin.shopifyProductId);
    const product = trackedByGid.get(gid);
    return {
      id: pin.id,
      shopifyProductId: gid,
      position: pin.position,
      title: product?.title ?? "Product",
      isSoldOut: product?.isSoldOut ?? false,
    };
  });
}

async function assertCanAddPin(
  shopDomain: string,
  collectionId: string,
): Promise<{ shopId: string; plan: PlanId }> {
  const shop = await ensureShop(shopDomain);
  const plan = shop.plan as PlanId;

  if (!isPinningAvailableForPlan(plan)) {
    throw new PinningNotAvailableError(
      "Product pinning is available on Growth and Pro plans. Upgrade on the Pricing page.",
    );
  }

  const limit = getPinnedProductLimitForPlan(plan);
  const currentCount = await prisma.pinnedProduct.count({
    where: { collectionId },
  });

  if (limit != null && currentCount >= limit) {
    throw new PlanLimitError(
      `Your ${plan === "GROWTH" ? "Growth" : "current"} plan allows up to ${limit} pinned products per collection. ` +
        `Remove a pin or upgrade on the Pricing page.`,
    );
  }

  return { shopId: shop.id, plan };
}

export async function addPinnedProduct(
  shopDomain: string,
  collectionId: string,
  shopifyProductId: string,
  admin: AdminGraphql,
): Promise<PinnedProductItem> {
  const context = await getCollectionForShop(shopDomain, collectionId);
  if (!context) {
    throw new Error("Collection not found.");
  }

  if (context.collection.sortOrder !== "MANUAL") {
    throw new Error(
      "Product pinning only works on manual collections.",
    );
  }

  await assertCanAddPin(shopDomain, collectionId);

  const productGid = toProductGid(shopifyProductId);

  const existing = await prisma.pinnedProduct.findUnique({
    where: {
      collectionId_shopifyProductId: {
        collectionId,
        shopifyProductId: productGid,
      },
    },
  });

  if (existing) {
    throw new Error("This product is already pinned.");
  }

  const pin = await prisma.$transaction(async (tx) => {
    const count = await tx.pinnedProduct.count({ where: { collectionId } });
    return tx.pinnedProduct.create({
      data: {
        shopId: context.shop.id,
        collectionId,
        shopifyProductId: productGid,
        position: count,
      },
    });
  });

  console.log(
    `[pinned-product] Added pin shop=${shopDomain} collection=${collectionId} ` +
      `product=${productGid} position=${pin.position}`,
  );

  await applyCollectionSortWithPins(shopDomain, admin, collectionId);

  const tracked = await prisma.trackedProduct.findFirst({
    where: {
      shopId: context.shop.id,
      shopifyProductId: productGid,
    },
    select: { title: true, isSoldOut: true },
  });

  return {
    id: pin.id,
    shopifyProductId: productGid,
    position: pin.position,
    title: tracked?.title ?? "Product",
    isSoldOut: tracked?.isSoldOut ?? false,
  };
}

export async function removePinnedProduct(
  shopDomain: string,
  pinnedProductId: string,
  admin: AdminGraphql,
): Promise<void> {
  const shop = await ensureShop(shopDomain);
  const pin = await prisma.pinnedProduct.findFirst({
    where: { id: pinnedProductId, shopId: shop.id },
  });

  if (!pin) {
    throw new Error("Pinned product not found.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.pinnedProduct.delete({ where: { id: pin.id } });

    const remaining = await tx.pinnedProduct.findMany({
      where: { collectionId: pin.collectionId },
      orderBy: { position: "asc" },
    });

    for (let index = 0; index < remaining.length; index++) {
      if (remaining[index].position !== index) {
        await tx.pinnedProduct.update({
          where: { id: remaining[index].id },
          data: { position: index },
        });
      }
    }
  });

  console.log(
    `[pinned-product] Removed pin shop=${shopDomain} collection=${pin.collectionId} ` +
      `product=${pin.shopifyProductId}`,
  );

  await applyCollectionSortWithPins(shopDomain, admin, pin.collectionId);
}

export async function reorderPinnedProducts(
  shopDomain: string,
  collectionId: string,
  orderedPinnedProductIds: string[],
  admin: AdminGraphql,
): Promise<void> {
  const shop = await ensureShop(shopDomain);
  const pins = await prisma.pinnedProduct.findMany({
    where: { collectionId, shopId: shop.id },
    orderBy: { position: "asc" },
  });

  if (pins.length === 0) {
    return;
  }

  if (orderedPinnedProductIds.length !== pins.length) {
    throw new Error("Invalid pin order.");
  }

  const pinIdSet = new Set(pins.map((pin) => pin.id));
  for (const id of orderedPinnedProductIds) {
    if (!pinIdSet.has(id)) {
      throw new Error("Invalid pinned product id.");
    }
  }

  await prisma.$transaction(async (tx) => {
    // Phase 1: move every pin to a unique temporary position so we never
    // collide on @@unique([collectionId, position]) while swapping.
    const tempBase = -(orderedPinnedProductIds.length + 1);
    for (let index = 0; index < orderedPinnedProductIds.length; index++) {
      await tx.pinnedProduct.update({
        where: { id: orderedPinnedProductIds[index] },
        data: { position: tempBase - index },
      });
    }

    // Phase 2: assign final sequential positions (0..n-1).
    for (let index = 0; index < orderedPinnedProductIds.length; index++) {
      await tx.pinnedProduct.update({
        where: { id: orderedPinnedProductIds[index] },
        data: { position: index },
      });
    }
  });

  console.log(
    `[pinned-product] Reordered pins shop=${shopDomain} collection=${collectionId}`,
  );

  await applyCollectionSortWithPins(shopDomain, admin, collectionId);
}

export type PinningOverviewRow = {
  id: string;
  title: string;
  productCount: number;
  pinsUsed: number;
  planLimitLabel: string;
  status: "unavailable" | "not_manual" | "empty" | "active" | "at_limit";
  statusLabel: string;
};

export type PinningOverviewList = {
  plan: PlanId;
  pinningAvailable: boolean;
  planLimitLabel: string;
  collections: PinningOverviewRow[];
};

function resolvePinningRowStatus(input: {
  pinningAvailable: boolean;
  isManual: boolean;
  pinsUsed: number;
  atLimit: boolean;
}): Pick<PinningOverviewRow, "status" | "statusLabel"> {
  if (!input.pinningAvailable) {
    return { status: "unavailable", statusLabel: "Unavailable" };
  }
  if (!input.isManual) {
    return { status: "not_manual", statusLabel: "Manual only" };
  }
  if (input.atLimit) {
    return { status: "at_limit", statusLabel: "At limit" };
  }
  if (input.pinsUsed === 0) {
    return { status: "empty", statusLabel: "No pins" };
  }
  return { status: "active", statusLabel: "Active" };
}

export async function listPinningOverviewForShop(
  shopDomain: string,
  admin: AdminGraphql,
): Promise<PinningOverviewList> {
  const { listCollectionManagementForShop } = await import(
    "./collection-management.server"
  );
  const { collections } = await listCollectionManagementForShop(shopDomain, admin);
  const shop = await ensureShop(shopDomain);
  const plan = shop.plan as PlanId;
  const pinningAvailable = isPinningAvailableForPlan(plan);
  const limit = getPinnedProductLimitForPlan(plan);
  const planLimitLabel = formatPinnedProductLimit(plan);

  const pinCounts = await prisma.pinnedProduct.groupBy({
    by: ["collectionId"],
    where: { shopId: shop.id },
    _count: { _all: true },
  });
  const pinsByCollection = new Map(
    pinCounts.map((row) => [row.collectionId, row._count._all]),
  );

  const rows: PinningOverviewRow[] = collections.map((collection) => {
    const pinsUsed = pinsByCollection.get(collection.id) ?? 0;
    const isManual = collection.sortOrder === "MANUAL";
    const atLimit =
      limit != null && limit > 0 && pinsUsed >= limit && pinningAvailable;

    const { status, statusLabel } = resolvePinningRowStatus({
      pinningAvailable,
      isManual,
      pinsUsed,
      atLimit,
    });

    return {
      id: collection.id,
      title: collection.title,
      productCount: collection.productCount,
      pinsUsed,
      planLimitLabel,
      status,
      statusLabel,
    };
  });

  rows.sort((a, b) => a.title.localeCompare(b.title));

  return {
    plan,
    pinningAvailable,
    planLimitLabel,
    collections: rows,
  };
}

export type PinningFormActionResult =
  | { success: true; intent: string }
  | { success: false; error: string; intent?: string };

export async function handlePinningFormAction(
  shopDomain: string,
  collectionId: string,
  formData: FormData,
  admin: AdminGraphql,
): Promise<PinningFormActionResult> {
  const intent = formData.get("intent");

  if (intent === "pin-product") {
    const productId = String(formData.get("productId") ?? "");
    if (!productId) {
      return { success: false, error: "Select a product to pin." };
    }

    try {
      await addPinnedProduct(shopDomain, collectionId, productId, admin);
      return { success: true, intent: "pin-product" };
    } catch (error) {
      return {
        success: false,
        intent: "pin-product",
        error:
          error instanceof PinningNotAvailableError ||
          error instanceof PlanLimitError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Could not pin product.",
      };
    }
  }

  if (intent === "unpin-product") {
    const pinnedProductId = String(formData.get("pinnedProductId") ?? "");
    if (!pinnedProductId) {
      return { success: false, error: "Missing pinned product." };
    }

    try {
      await removePinnedProduct(shopDomain, pinnedProductId, admin);
      return { success: true, intent: "unpin-product" };
    } catch (error) {
      return {
        success: false,
        intent: "unpin-product",
        error:
          error instanceof Error ? error.message : "Could not remove pin.",
      };
    }
  }

  if (intent === "move-pin-up" || intent === "move-pin-down") {
    const pinnedProductId = String(formData.get("pinnedProductId") ?? "");
    try {
      const pins = await listPinnedProductsForCollection(
        shopDomain,
        collectionId,
      );
      const index = pins.findIndex((pin) => pin.id === pinnedProductId);
      if (index === -1) {
        return { success: false, error: "Pinned product not found." };
      }

      const targetIndex = intent === "move-pin-up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= pins.length) {
        return { success: true, intent: "reorder-pinned" };
      }

      const ordered = [...pins];
      const [moved] = ordered.splice(index, 1);
      ordered.splice(targetIndex, 0, moved);

      await reorderPinnedProducts(
        shopDomain,
        collectionId,
        ordered.map((pin) => pin.id),
        admin,
      );
      return { success: true, intent: "reorder-pinned" };
    } catch (error) {
      return {
        success: false,
        intent: "reorder-pinned",
        error:
          error instanceof Error ? error.message : "Could not reorder pins.",
      };
    }
  }

  return { success: false, error: "Unknown action." };
}
