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
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
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
    if (fetcher.data?.success) {
      shopify.toast.show("Settings saved");
    }
  }, [fetcher.data, shopify]);

  const isSaving =
    fetcher.state === "submitting" || fetcher.state === "loading";
  const saveError = fetcher.data?.success === false ? fetcher.data.error : null;
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

  if (loadError) {
    return (
      <s-page heading="Settings">
        <s-banner tone="critical" heading="Unable to load settings">
          <s-paragraph>{loadError}</s-paragraph>
        </s-banner>
      </s-page>
    );
  }

  return (
    <s-page heading="Settings">
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
        <s-paragraph>
          Control whether the app is active and how sold-out products should be
          handled once inventory sorting is enabled.
        </s-paragraph>

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
        <s-paragraph>
          Choose where products go when they come back in stock.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          <s-checkbox
            label="Restore to original position"
            checked={restorePosition === "ORIGINAL"}
            disabled={restorePositionDisabled}
            onChange={() => setRestorePosition("ORIGINAL")}
          />
          <s-checkbox
            label="Restore to top of collection"
            checked={restorePosition === "TOP"}
            disabled={restorePositionDisabled}
            onChange={() => setRestorePosition("TOP")}
          />
        </s-stack>

        {fieldErrors?.restorePosition && (
          <s-banner tone="critical">
            <s-paragraph>{fieldErrors.restorePosition}</s-paragraph>
          </s-banner>
        )}
      </s-section>

      <s-section slot="aside" heading="Note">
        <s-paragraph>
          These preferences are saved to your store. Product sorting will be
          applied in a future update.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
