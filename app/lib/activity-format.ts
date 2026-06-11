import type { ActivityType, InventoryStatus, TriggerSource } from "@prisma/client";

import { formatInventoryStatusLabel } from "./inventory-status";

export type ActivityFeedTone = "success" | "info" | "warning" | "critical";

export type ActivityFeedItem = {
  id: string;
  category:
    | "inventory"
    | "move"
    | "restore"
    | "sync"
    | "backfill"
    | "skipped";
  title: string;
  description: string;
  occurredAt: string;
  tone: ActivityFeedTone;
};

export function formatTriggerSource(source: TriggerSource): string {
  switch (source) {
    case "WEBHOOK_INVENTORY":
      return "Inventory webhook";
    case "WEBHOOK_PRODUCT":
      return "Product webhook";
    case "BACKFILL":
      return "Backfill";
    case "MANUAL":
      return "Manual";
    default:
      return source;
  }
}

export function formatActivityTypeLabel(type: ActivityType): string {
  switch (type) {
    case "PUSH_SOLD_OUT":
      return "Moved to bottom";
    case "RESTORE_ORIGINAL":
      return "Restored to original";
    case "RESTORE_TOP":
      return "Restored to top";
    case "REORDER_SKIPPED":
      return "Reorder skipped";
    case "COLLECTION_SYNCED":
      return "Collection synced";
    case "COLLECTION_DELETED":
      return "Collection removed";
    case "BACKFILL_SOLD_OUT_COMPLETED":
      return "Sold-out sync completed";
    case "BACKFILL_COLLECTIONS_COMPLETED":
      return "Collection backfill completed";
    default:
      return type;
  }
}

export function formatInventoryChangeTitle(
  productTitle: string | null,
  shopifyProductId: string,
): string {
  if (productTitle) {
    return productTitle;
  }
  const parts = shopifyProductId.split("/");
  return `Product ${parts[parts.length - 1] ?? shopifyProductId}`;
}

export function formatInventoryChangeDescription(
  previousStatus: InventoryStatus,
  newStatus: InventoryStatus,
  totalAvailable: number,
  triggerSource: TriggerSource,
): string {
  return (
    `${formatInventoryStatusLabel(previousStatus)} → ` +
    `${formatInventoryStatusLabel(newStatus)} · ` +
    `${totalAvailable} available · ${formatTriggerSource(triggerSource)}`
  );
}

export function activityTypeToCategory(
  type: ActivityType,
): ActivityFeedItem["category"] {
  switch (type) {
    case "PUSH_SOLD_OUT":
      return "move";
    case "RESTORE_ORIGINAL":
    case "RESTORE_TOP":
      return "restore";
    case "REORDER_SKIPPED":
      return "skipped";
    case "COLLECTION_SYNCED":
    case "COLLECTION_DELETED":
      return "sync";
    case "BACKFILL_SOLD_OUT_COMPLETED":
    case "BACKFILL_COLLECTIONS_COMPLETED":
      return "backfill";
    default:
      return "sync";
  }
}

export function activityTypeToTone(type: ActivityType): ActivityFeedTone {
  switch (type) {
    case "PUSH_SOLD_OUT":
    case "RESTORE_ORIGINAL":
    case "RESTORE_TOP":
    case "COLLECTION_SYNCED":
    case "BACKFILL_SOLD_OUT_COMPLETED":
    case "BACKFILL_COLLECTIONS_COMPLETED":
      return "success";
    case "REORDER_SKIPPED":
      return "warning";
    case "COLLECTION_DELETED":
      return "info";
    default:
      return "info";
  }
}

export function formatPositionChange(
  oldPosition: number | null,
  newPosition: number | null,
): string {
  if (oldPosition == null && newPosition == null) {
    return "";
  }
  if (oldPosition == null) {
    return `→ position ${newPosition}`;
  }
  if (newPosition == null) {
    return `position ${oldPosition}`;
  }
  return `position ${oldPosition} → ${newPosition}`;
}
