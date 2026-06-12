import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import type { PlanId } from "../lib/pricing-plans";
import { syncShopBillingFromShopify } from "../models/billing.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const requestedPlan = url.searchParams.get("plan") as PlanId | null;

  const snapshot = await syncShopBillingFromShopify(session.shop, billing);

  const params = new URLSearchParams();
  params.set("billing", "confirmed");
  if (requestedPlan) {
    params.set("plan", snapshot.plan);
  }

  return redirect(`/app/pricing?${params.toString()}`);
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
