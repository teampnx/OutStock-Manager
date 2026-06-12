import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { RestorePosition } from "@prisma/client";

import { authenticate } from "../shopify.server";
import {
  backfillSoldOutProductsForShop,
  type BackfillSoldOutProductsResult,
} from "../models/collection-reorder.server";
import {
  getSettingsForShop,
  parseSettingsFormData,
  updateSettingsForShop,
} from "../models/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  try {
    const settings = await getSettingsForShop(session.shop);
    return { settings, error: null };
  } catch {
    return {
      settings: null,
      error: "Could not load settings. Please refresh the page.",
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("intent") === "backfill-sold-out") {
    try {
      const backfill = await backfillSoldOutProductsForShop(session.shop, admin);
      return {
        success: true as const,
        intent: "backfill-sold-out" as const,
        backfill,
      };
    } catch {
      return {
        success: false as const,
        intent: "backfill-sold-out" as const,
        error: "Could not sync sold-out products. Please try again.",
      };
    }
  }

  const parsed = parseSettingsFormData(formData);

  if (!parsed.ok) {
    return {
      success: false as const,
      error: parsed.error,
      fieldErrors: parsed.fieldErrors ?? {},
    };
  }

  const result = await updateSettingsForShop(session.shop, parsed.data);

  if (!result.success) {
    return {
      success: false as const,
      error: result.error,
      fieldErrors: result.fieldErrors ?? {},
    };
  }

  return {
    success: true as const,
    settings: result.settings,
  };
};

export default function SettingsPage() {
  const { settings: initialSettings, error: loadError } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const settings = fetcher.data?.success
    ? fetcher.data.settings
    : initialSettings;

  const [enabled, setEnabled] = useState(settings?.enabled ?? false);
  const [pushSoldOutToBottom, setPushSoldOutToBottom] = useState(
    settings?.pushSoldOutToBottom ?? true,
  );
  const [restoreWhenBackInStock, setRestoreWhenBackInStock] = useState(
    settings?.restoreWhenBackInStock ?? true,
  );
  const [restorePosition, setRestorePosition] = useState<RestorePosition>(
    settings?.restorePosition ?? "ORIGINAL",
  );

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setPushSoldOutToBottom(settings.pushSoldOutToBottom);
    setRestoreWhenBackInStock(settings.restoreWhenBackInStock);
    setRestorePosition(settings.restorePosition);
  }, [settings]);

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.intent === "backfill-sold-out") {
      shopify.toast.show("Sold-out product sync completed");
    } else if (fetcher.data?.success && !fetcher.data.intent) {
      shopify.toast.show("Settings saved");
    }
  }, [fetcher.data, shopify]);

  const isSaving =
    fetcher.state === "submitting" || fetcher.state === "loading";
  const isSyncingSoldOut =
    fetcher.formData?.get("intent") === "backfill-sold-out" && isSaving;
  const backfillResult: BackfillSoldOutProductsResult | null =
    fetcher.data?.success && fetcher.data.intent === "backfill-sold-out"
      ? fetcher.data.backfill
      : null;
  const backfillError =
    fetcher.data?.success === false &&
    fetcher.data.intent === "backfill-sold-out"
      ? fetcher.data.error
      : null;
  const saveError =
    fetcher.data?.success === false && fetcher.data.intent !== "backfill-sold-out"
      ? fetcher.data.error
      : null;
  const fieldErrors =
    fetcher.data?.success === false ? fetcher.data.fieldErrors : undefined;

  const behaviorDisabled = !enabled;
  const restorePositionDisabled = behaviorDisabled || !restoreWhenBackInStock;

  const handleSave = () => {
    fetcher.submit(
      {
        enabled: enabled ? "on" : "off",
        pushSoldOutToBottom: pushSoldOutToBottom ? "on" : "off",
        restoreWhenBackInStock: restoreWhenBackInStock ? "on" : "off",
        restorePosition,
      },
      { method: "post" },
    );
  };

  const handleSyncSoldOut = () => {
    fetcher.submit({ intent: "backfill-sold-out" }, { method: "post" });
  };

  if (loadError) {
    return (
      <s-page heading="Settings" inlineSize="large">
        <s-banner tone="critical" heading="Unable to load settings">
          <s-paragraph>{loadError}</s-paragraph>
        </s-banner>
      </s-page>
    );
  }

  return (
    <s-page heading="Settings" inlineSize="large">
      <s-button
        slot="primary-action"
        onClick={handleSave}
        {...(isSaving ? { loading: true } : {})}
        disabled={isSaving}
      >
        Save
      </s-button>

      {saveError && (
        <s-banner tone="critical" heading="Could not save settings">
          <s-paragraph>{saveError}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="OutStock Manager">
        <p className="settings-section-lead">
          Control whether the app is active and how sold-out products should be
          handled once inventory sorting is enabled.
        </p>

        <s-stack direction="block" gap="base">
          <s-checkbox
            label="Enable OutStock Manager"
            details="Turn on OutStock Manager for this store."
            checked={enabled}
            onChange={(event) => setEnabled(event.currentTarget.checked ?? false)}
          />

          <s-checkbox
            label="Push sold out products to bottom"
            details="Move sold-out products to the end of collections."
            checked={pushSoldOutToBottom}
            disabled={behaviorDisabled}
            onChange={(event) =>
              setPushSoldOutToBottom(event.currentTarget.checked ?? false)
            }
          />

          <s-checkbox
            label="Restore products when back in stock"
            details="Return products to the catalog when inventory is available again."
            checked={restoreWhenBackInStock}
            disabled={behaviorDisabled}
            onChange={(event) =>
              setRestoreWhenBackInStock(event.currentTarget.checked ?? false)
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="Restore position">
        <p className="settings-section-lead">
          Choose where products go when they come back in stock.
        </p>

        <s-stack direction="inline" gap="small-100">
          <s-clickable-chip
            color={restorePosition === "ORIGINAL" ? "strong" : "base"}
            disabled={restorePositionDisabled}
            onClick={() => setRestorePosition("ORIGINAL")}
          >
            Original position
          </s-clickable-chip>
          <s-clickable-chip
            color={restorePosition === "TOP" ? "strong" : "base"}
            disabled={restorePositionDisabled}
            onClick={() => setRestorePosition("TOP")}
          >
            Top of collection
          </s-clickable-chip>
        </s-stack>

        {fieldErrors?.restorePosition && (
          <s-banner tone="critical">
            <s-paragraph>{fieldErrors.restorePosition}</s-paragraph>
          </s-banner>
        )}
      </s-section>

      <s-section heading="Sync sold-out products">
        <p className="settings-section-lead">
          One-time sync for products that were already sold out before automatic
          sorting was enabled. Moves each sold-out product to the bottom of its
          manual collections and preserves original positions for restore.
        </p>

        <s-button
          onClick={handleSyncSoldOut}
          {...(isSyncingSoldOut ? { loading: true } : {})}
          disabled={isSyncingSoldOut || isSaving}
        >
          Sync Sold-Out Products
        </s-button>

        {backfillError && (
          <s-banner tone="critical" heading="Sync failed">
            <s-paragraph>{backfillError}</s-paragraph>
          </s-banner>
        )}

        {backfillResult && (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <div className="settings-result-grid">
              <div>
                <p className="settings-result-label">Products scanned</p>
                <p className="settings-result-value">
                  {backfillResult.scannedProducts}
                </p>
              </div>
              <div>
                <p className="settings-result-label">Memberships processed</p>
                <p className="settings-result-value">
                  {backfillResult.scannedMemberships}
                </p>
              </div>
              <div>
                <p className="settings-result-label">Reordered</p>
                <p className="settings-result-value">{backfillResult.reordered}</p>
              </div>
              <div>
                <p className="settings-result-label">Skipped</p>
                <p className="settings-result-value">{backfillResult.skipped}</p>
              </div>
              <div>
                <p className="settings-result-label">Failed</p>
                <p className="settings-result-value">{backfillResult.failed}</p>
              </div>
            </div>
          </s-box>
        )}
      </s-section>

      <s-section slot="aside" heading="Help">
        <s-stack direction="block" gap="base">
          <div className="settings-aside-card">
            <p className="settings-aside-title">Need more capacity?</p>
            <p className="settings-aside-text">
              Upgrade your plan to track more products and enable sorting on
              additional collections.
            </p>
            <s-link href="/app/pricing">View pricing</s-link>
          </div>
          <div className="settings-aside-card">
            <p className="settings-aside-title">Automatic vs. one-time sync</p>
            <p className="settings-aside-text">
              New inventory changes are handled automatically when the app is
              enabled. Use sync sold-out products to catch up existing sold-out
              items.
            </p>
          </div>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
