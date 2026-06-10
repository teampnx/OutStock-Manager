import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { formatInventoryStatusLabel } from "../lib/inventory-status";
import { listTrackedProductsForShop } from "../models/tracked-product.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  try {
    const products = await listTrackedProductsForShop(session.shop);
    return { products, error: null };
  } catch {
    return {
      products: [],
      error: "Could not load tracked products. Please refresh the page.",
    };
  }
};

function formatTimestamp(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatProductId(shopifyProductId: string) {
  const parts = shopifyProductId.split("/");
  return parts[parts.length - 1] ?? shopifyProductId;
}

export default function ProductsPage() {
  const { products, error } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Products">
      {error && (
        <s-banner tone="critical" heading="Unable to load products">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Tracked inventory">
        <s-paragraph>
          Products appear here after Shopify inventory or product update webhooks
          are processed.
        </s-paragraph>

        {products.length === 0 ? (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-paragraph>No tracked products yet.</s-paragraph>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {products.map((product) => (
              <s-box
                key={product.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-paragraph>
                    <s-text type="strong">Product: </s-text>
                    {product.title ?? `Product ${formatProductId(product.shopifyProductId)}`}
                  </s-paragraph>
                  <s-paragraph>
                    <s-text type="strong">Inventory: </s-text>
                    {product.totalAvailable} ({product.inventoryPolicy})
                  </s-paragraph>
                  <s-paragraph>
                    <s-text type="strong">Status: </s-text>
                    {formatInventoryStatusLabel(product.status)}
                  </s-paragraph>
                  <s-paragraph>
                    <s-text type="strong">Last change: </s-text>
                    {formatTimestamp(product.lastStatusChangeAt)}
                  </s-paragraph>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
