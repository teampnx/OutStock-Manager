import type { CollectionSortOrder } from "@prisma/client";

const SHOPIFY_SORT_ORDERS: CollectionSortOrder[] = [
  "MANUAL",
  "ALPHA_ASC",
  "ALPHA_DESC",
  "BEST_SELLING",
  "CREATED",
  "CREATED_DESC",
  "PRICE_ASC",
  "PRICE_DESC",
];

export function mapShopifySortOrder(sortOrder: string): CollectionSortOrder {
  if (SHOPIFY_SORT_ORDERS.includes(sortOrder as CollectionSortOrder)) {
    return sortOrder as CollectionSortOrder;
  }
  return "MANUAL";
}

export function getCollectionSortBlockedReason(
  enabled: boolean,
  sortOrder: CollectionSortOrder,
): string | null {
  if (!enabled || sortOrder === "MANUAL") {
    return null;
  }

  return (
    "Sold-out sorting only works when the collection uses Manual sort in Shopify " +
    `Admin. This collection is set to ${formatCollectionSortOrderLabel(sortOrder)}.`
  );
}

export function formatCollectionSortOrderLabel(
  sortOrder: CollectionSortOrder,
): string {
  switch (sortOrder) {
    case "MANUAL":
      return "Manual";
    case "ALPHA_ASC":
      return "Alphabetically, A-Z";
    case "ALPHA_DESC":
      return "Alphabetically, Z-A";
    case "BEST_SELLING":
      return "Best selling";
    case "CREATED":
      return "Date, old to new";
    case "CREATED_DESC":
      return "Date, new to old";
    case "PRICE_ASC":
      return "Price, low to high";
    case "PRICE_DESC":
      return "Price, high to low";
    default:
      return "None";
  }
}
