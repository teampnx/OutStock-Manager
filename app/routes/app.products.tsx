import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { formatDateTime } from "../lib/format-datetime";
import { formatInventoryStatusLabel } from "../lib/inventory-status";
import type { ProductDashboardItem } from "../models/product-dashboard.server";
import { listProductDashboardForShop } from "../models/product-dashboard.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const data = await listProductDashboardForShop(session.shop, admin);
    return { ...data, error: null };
  } catch (error) {
    console.error(
      `[products] Failed to load product dashboard for ${session.shop}:`,
      error,
    );
    return {
      products: [],
      summary: {
        totalTrackedProducts: 0,
        inStockProducts: 0,
        soldOutProducts: 0,
        productsMoved: 0,
        productsRestored: 0,
      },
      error: "Could not load tracked products. Please refresh the page.",
    };
  }
};

type StockFilter = "all" | "in_stock" | "sold_out";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="subdued"
    >
      <s-stack direction="block" gap="small">
        <s-paragraph>
          <s-text type="strong">{label}</s-text>
        </s-paragraph>
        <s-paragraph>{value}</s-paragraph>
      </s-stack>
    </s-box>
  );
}

function formatLastAction(action: ProductDashboardItem["lastReorderAction"]) {
  if (!action) {
    return "—";
  }

  const positionText =
    action.oldPosition != null && action.newPosition != null
      ? ` · position ${action.oldPosition} → ${action.newPosition}`
      : "";

  const collectionText = action.collectionTitle
    ? ` in ${action.collectionTitle}`
    : "";

  return `${action.label}${collectionText}${positionText} · ${formatDateTime(action.occurredAt)}`;
}

function matchesFilter(product: ProductDashboardItem, filter: StockFilter) {
  if (filter === "in_stock") {
    return product.status === "IN_STOCK";
  }
  if (filter === "sold_out") {
    return product.status === "SOLD_OUT";
  }
  return true;
}

function ProductCard({ product }: { product: ProductDashboardItem }) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="subdued"
    >
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.imageAlt ?? product.title}
              width={64}
              height={64}
              style={{
                objectFit: "cover",
                borderRadius: "8px",
                flexShrink: 0,
              }}
            />
          ) : (
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="base"
            >
              <s-paragraph>No image</s-paragraph>
            </s-box>
          )}

          <s-stack direction="block" gap="small">
            <s-paragraph>
              <s-text type="strong">{product.title}</s-text>
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Inventory: </s-text>
              {product.totalAvailable} ({product.inventoryPolicy})
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Status: </s-text>
              {formatInventoryStatusLabel(product.status)}
            </s-paragraph>
          </s-stack>
        </s-stack>

        <s-stack direction="block" gap="small">
          <s-paragraph>
            <s-text type="strong">Last inventory change: </s-text>
            {formatDateTime(product.lastInventoryChangeAt)}
          </s-paragraph>
          <s-paragraph>
            <s-text type="strong">Last reorder: </s-text>
            {formatLastAction(product.lastReorderAction)}
          </s-paragraph>
          <s-paragraph>
            <s-text type="strong">Last restore: </s-text>
            {formatLastAction(product.lastRestoreAction)}
          </s-paragraph>
        </s-stack>

        <s-stack direction="block" gap="small">
          <s-paragraph>
            <s-text type="strong">Collections</s-text>
          </s-paragraph>
          {product.collections.length === 0 ? (
            <s-paragraph>Not in any tracked collections</s-paragraph>
          ) : (
            product.collections.map((collection) => (
              <s-paragraph key={`${product.id}-${collection.collectionId}`}>
                {collection.collectionTitle}: original {collection.originalPosition},
                current {collection.currentPosition}
              </s-paragraph>
            ))
          )}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export default function ProductsPage() {
  const { products, summary, error } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return products.filter((product) => {
      if (!matchesFilter(product, filter)) {
        return false;
      }

      if (!query) {
        return true;
      }

      return product.title.toLowerCase().includes(query);
    });
  }, [products, search, filter]);

  return (
    <s-page heading="Products">
      {error && (
        <s-banner tone="critical" heading="Unable to load products">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Summary">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <StatCard
              label="Total tracked products"
              value={summary.totalTrackedProducts}
            />
            <StatCard label="In stock" value={summary.inStockProducts} />
            <StatCard label="Sold out" value={summary.soldOutProducts} />
          </s-stack>
          <s-stack direction="inline" gap="base">
            <StatCard label="Products moved" value={summary.productsMoved} />
            <StatCard label="Products restored" value={summary.productsRestored} />
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Product visibility">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Search products"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search by product name"
          />

          <s-stack direction="inline" gap="base">
            <s-button
              variant={filter === "all" ? "primary" : "secondary"}
              onClick={() => setFilter("all")}
            >
              All
            </s-button>
            <s-button
              variant={filter === "in_stock" ? "primary" : "secondary"}
              onClick={() => setFilter("in_stock")}
            >
              In Stock
            </s-button>
            <s-button
              variant={filter === "sold_out" ? "primary" : "secondary"}
              onClick={() => setFilter("sold_out")}
            >
              Sold Out
            </s-button>
          </s-stack>

          <s-paragraph>
            Showing {filteredProducts.length} of {products.length} products
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
          ) : filteredProducts.length === 0 ? (
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-paragraph>No products match your search or filter.</s-paragraph>
            </s-box>
          ) : (
            <s-stack direction="block" gap="base">
              {filteredProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </s-stack>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
