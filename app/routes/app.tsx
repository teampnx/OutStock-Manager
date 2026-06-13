import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { APP_DESCRIPTION, APP_NAME } from "../lib/branding";
import { authenticate } from "../shopify.server";
import { ensureShop, fetchShopName } from "../models/shop.server";
import tokensStylesheet from "../styles/tokens.css?url";
import curatifyStylesheet from "../styles/curatify.css?url";
import activityStylesheet from "../styles/activity.css?url";
import appSharedStylesheet from "../styles/app-shared.css?url";
import collectionPreviewStylesheet from "../styles/collection-preview.css?url";
import collectionsStylesheet from "../styles/collections.css?url";
import dashboardStylesheet from "../styles/dashboard.css?url";
import homeStylesheet from "../styles/home.css?url";
import pinningStylesheet from "../styles/pinning.css?url";
import pricingStylesheet from "../styles/pricing.css?url";
import settingsStylesheet from "../styles/settings.css?url";

import "../styles/tokens.css";
import "../styles/curatify.css";
import "../styles/activity.css";
import "../styles/app-shared.css";
import "../styles/collection-preview.css";
import "../styles/collections.css";
import "../styles/dashboard.css";
import "../styles/home.css";
import "../styles/pinning.css";
import "../styles/pricing.css";
import "../styles/settings.css";

export function meta() {
  return [
    { title: APP_NAME },
    { name: "description", content: APP_DESCRIPTION },
  ];
}

export function links() {
  return [
    { rel: "stylesheet", href: tokensStylesheet },
    { rel: "stylesheet", href: curatifyStylesheet },
    { rel: "stylesheet", href: appSharedStylesheet },
    { rel: "stylesheet", href: collectionsStylesheet },
    { rel: "stylesheet", href: collectionPreviewStylesheet },
    { rel: "stylesheet", href: dashboardStylesheet },
    { rel: "stylesheet", href: activityStylesheet },
    { rel: "stylesheet", href: homeStylesheet },
    { rel: "stylesheet", href: pinningStylesheet },
    { rel: "stylesheet", href: pricingStylesheet },
    { rel: "stylesheet", href: settingsStylesheet },
  ];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopName = await fetchShopName(admin);
  await ensureShop(session.shop, shopName);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <div className="curatify-app">
        <s-app-nav>
          {/* Native anchor so App Bridge receives rel="home" (parent nav → /app). */}
          <a href="/app" rel="home">
            Home
          </a>
          <s-link href="/app/dashboard">Dashboard</s-link>
          <s-link href="/app/collections">Collections</s-link>
          <s-link href="/app/pinning">Pinning</s-link>
          <s-link href="/app/activity">Activity</s-link>
          <s-link href="/app/pricing">Pricing</s-link>
          <s-link href="/app/settings">Settings</s-link>
        </s-app-nav>
        <Outlet />
      </div>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
