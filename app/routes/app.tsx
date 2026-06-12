import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { ensureShop, fetchShopName } from "../models/shop.server";
import activityStylesheet from "../styles/activity.css?url";
import appSharedStylesheet from "../styles/app-shared.css?url";
import dashboardStylesheet from "../styles/dashboard.css?url";
import homeStylesheet from "../styles/home.css?url";
import pricingStylesheet from "../styles/pricing.css?url";
import settingsStylesheet from "../styles/settings.css?url";

import "../styles/activity.css";
import "../styles/app-shared.css";
import "../styles/dashboard.css";
import "../styles/home.css";
import "../styles/pricing.css";
import "../styles/settings.css";

export function links() {
  return [
    { rel: "stylesheet", href: appSharedStylesheet },
    { rel: "stylesheet", href: dashboardStylesheet },
    { rel: "stylesheet", href: activityStylesheet },
    { rel: "stylesheet", href: homeStylesheet },
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
      <s-app-nav>
        {/* Native anchor so App Bridge receives rel="home" (parent nav → /app). */}
        <a href="/app" rel="home">
          Home
        </a>
        <s-link href="/app/dashboard">Dashboard</s-link>
        <s-link href="/app/collections">Collections</s-link>
        <s-link href="/app/activity">Activity</s-link>
        <s-link href="/app/pricing">Pricing</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
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
