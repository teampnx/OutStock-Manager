/** Merchant-facing app branding (display only — routes and schema unchanged). */
export const APP_NAME = "curatify";
export const APP_TAGLINE = "Collection Sort & Merch";
export const APP_NAME_SHORT = "curatify";
export const SUPPORT_EMAIL = "support@curatify.app";

export const APP_DESCRIPTION =
  "Automatically sort sold-out products to the bottom of manual Shopify collections and restore them when inventory returns.";

export const BRAND_COLORS = {
  primary: "#5B4FCF",
  purpleDark: "#3D2F9E",
  purpleMid: "#7B6FDF",
  purpleLight: "#EAE7FB",
  background: "#F5F4FC",
  ink: "#1A1625",
  muted: "#6E6A88",
  success: "#22C55E",
  error: "#EF4444",
  warning: "#F59E0B",
} as const;

/** KPI chart and card accent colors */
export const KPI_ACCENTS = {
  products: BRAND_COLORS.primary,
  collections: BRAND_COLORS.purpleMid,
  inStock: BRAND_COLORS.success,
  soldOut: BRAND_COLORS.error,
  moved: BRAND_COLORS.warning,
  restored: BRAND_COLORS.purpleDark,
} as const;

export function pageTitle(page?: string): string {
  if (!page) {
    return `${APP_NAME} · ${APP_TAGLINE}`;
  }
  return `${page} · ${APP_NAME}`;
}
