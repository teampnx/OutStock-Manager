export function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  return formatStoreDateTime(value);
}

export function formatStoreDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value instanceof Date ? value : new Date(value));
}
