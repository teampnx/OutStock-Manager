export type DisplayInventoryStatus = "IN_STOCK" | "SOLD_OUT" | "UNKNOWN";

export function formatInventoryStatusLabel(
  status: DisplayInventoryStatus,
): string {
  switch (status) {
    case "IN_STOCK":
      return "In Stock";
    case "SOLD_OUT":
      return "Out of Stock";
    default:
      return "Unknown";
  }
}
