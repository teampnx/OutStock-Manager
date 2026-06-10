import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getShopByDomain } from "../models/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  try {
    const shop = await getShopByDomain(session.shop);

    if (!shop?.settings) {
      return {
        shopDomain: session.shop,
        shopName: shop?.shopName ?? session.shop,
        plan: shop?.plan ?? "FREE",
        settings: null,
        error: "Unable to load store settings.",
      };
    }

    return {
      shopDomain: shop.shopDomain,
      shopName: shop.shopName ?? shop.shopDomain,
      plan: shop.plan,
      settings: shop.settings,
      error: null,
    };
  } catch {
    return {
      shopDomain: session.shop,
      shopName: session.shop,
      plan: "FREE" as const,
      settings: null,
      error: "Something went wrong loading your dashboard.",
    };
  }
};

function formatRestorePosition(position: string) {
  return position === "TOP" ? "Top of collection" : "Original position";
}

export default function Dashboard() {
  const { shopName, plan, settings, error } = useLoaderData<typeof loader>();

  const isEnabled = settings?.enabled ?? false;

  return (
    <s-page heading="OutStock Manager">
      <s-link slot="primary-action" href="/app/settings">
        Manage settings
      </s-link>

      {error && (
        <s-banner tone="critical" heading="Unable to load dashboard">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Store overview">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-text type="strong">Store: </s-text>
            {shopName}
          </s-paragraph>
          <s-paragraph>
            <s-text type="strong">Plan: </s-text>
            {plan}
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="App status">
        {settings ? (
          <s-stack direction="block" gap="base">
            <s-banner
              tone={isEnabled ? "success" : "warning"}
              heading={isEnabled ? "OutStock Manager is enabled" : "OutStock Manager is disabled"}
            >
              <s-paragraph>
                {isEnabled
                  ? "Your out-of-stock sorting preferences are saved and ready for the next phase."
                  : "Enable the app in Settings to prepare your store for automatic sold-out sorting."}
              </s-paragraph>
            </s-banner>

            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="small">
                <s-paragraph>
                  <s-text type="strong">Push sold out to bottom: </s-text>
                  {settings.pushSoldOutToBottom ? "On" : "Off"}
                </s-paragraph>
                <s-paragraph>
                  <s-text type="strong">Restore when back in stock: </s-text>
                  {settings.restoreWhenBackInStock ? "On" : "Off"}
                </s-paragraph>
                {settings.restoreWhenBackInStock && (
                  <s-paragraph>
                    <s-text type="strong">Restore position: </s-text>
                    {formatRestorePosition(settings.restorePosition)}
                  </s-paragraph>
                )}
              </s-stack>
            </s-box>
          </s-stack>
        ) : (
          <s-paragraph>Settings are not available yet. Open Settings to finish setup.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Getting started">
        <s-unordered-list>
          <s-list-item>
            Configure how sold-out products should behave in Settings.
          </s-list-item>
          <s-list-item>
            Inventory sorting will be available in a future release.
          </s-list-item>
        </s-unordered-list>
        <s-link href="/app/settings">Go to Settings</s-link>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
