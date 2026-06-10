import type { InventoryStatus } from "@prisma/client";

export type ProductVariantInventory = {
  tracksInventory: boolean;
  inventoryPolicy: "DENY" | "CONTINUE";
  available: number;
};

export type ProductInventoryInput = {
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  variants: ProductVariantInventory[];
};

export function getProductInventoryStatus(
  input: ProductInventoryInput,
): InventoryStatus {
  if (input.status !== "ACTIVE") {
    return "UNKNOWN";
  }

  const trackingVariants = input.variants.filter(
    (variant) => variant.tracksInventory,
  );

  if (trackingVariants.length === 0) {
    return "UNKNOWN";
  }

  if (trackingVariants.some((variant) => variant.inventoryPolicy === "CONTINUE")) {
    return "IN_STOCK";
  }

  const totalAvailable = trackingVariants.reduce(
    (sum, variant) => sum + variant.available,
    0,
  );

  return totalAvailable <= 0 ? "SOLD_OUT" : "IN_STOCK";
}

export function inventoryStatusToSoldOutFlag(status: InventoryStatus): boolean {
  return status === "SOLD_OUT";
}
