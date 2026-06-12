import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { syncShopBillingFromAdmin } from "../models/billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin, session } =
    await authenticate.webhook(request);

  console.log(
    `[webhook] ${topic} for ${shop} subscription=${JSON.stringify(payload)}`,
  );

  if (!session || !admin) {
    return new Response();
  }

  try {
    await syncShopBillingFromAdmin(shop, admin);
  } catch (error) {
    console.error(
      `[webhook] Failed to sync billing after ${topic} for ${shop}:`,
      error,
    );
  }

  return new Response();
};
