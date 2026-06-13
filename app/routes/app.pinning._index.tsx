import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { pageTitle } from "../lib/branding";
import { listPinningOverviewForShop } from "../models/pinned-product.server";
import { authenticate } from "../shopify.server";

export function meta() {
  return [{ title: pageTitle("Pinning") }];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const data = await listPinningOverviewForShop(session.shop, admin);
    return { ...data, error: null };
  } catch (error) {
    console.error(`[pinning] Failed to load overview for ${session.shop}:`, error);
    return {
      plan: "FREE" as const,
      pinningAvailable: false,
      planLimitLabel: "Unavailable on Free",
      collections: [],
      error: "Could not load pinning overview. Please refresh the page.",
    };
  }
};

function statusClass(status: string) {
  return `pinning-status-badge pinning-status-${status}`;
}

export default function PinningOverviewPage() {
  const { collections, pinningAvailable, plan, planLimitLabel, error } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const totalPins = collections.reduce((sum, row) => sum + row.pinsUsed, 0);
  const activeCollections = collections.filter(
    (row) => row.status === "active" || row.status === "at_limit",
  ).length;

  return (
    <s-page heading="Pinning" inlineSize="large">
      {error ? (
        <s-banner tone="critical" heading="Unable to load pinning">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      ) : null}

      {!pinningAvailable ? (
        <div className="curatify-banner">
          <p className="curatify-banner-title">Upgrade to unlock product pinning</p>
          <p className="curatify-banner-text">
            Pin products to the top of manual collections on Growth (5 pins per
            collection) or Pro (unlimited).{" "}
            <s-link href="/app/pricing">View pricing</s-link>
          </p>
        </div>
      ) : plan === "GROWTH" ? (
        <div className="curatify-banner">
          <p className="curatify-banner-title">Growth plan</p>
          <p className="curatify-banner-text">
            You can pin up to 5 products per manual collection. Need unlimited
            pins? <s-link href="/app/pricing">Upgrade to Pro</s-link>.
          </p>
        </div>
      ) : null}

      <s-section heading="Overview">
        <div className="pinning-overview-stats">
          <div className="pinning-stat-card">
            <p className="pinning-stat-value">{collections.length}</p>
            <p className="pinning-stat-label">Collections</p>
          </div>
          <div className="pinning-stat-card">
            <p className="pinning-stat-value">{totalPins}</p>
            <p className="pinning-stat-label">Total pins</p>
          </div>
          <div className="pinning-stat-card">
            <p className="pinning-stat-value">{activeCollections}</p>
            <p className="pinning-stat-label">Collections with pins</p>
          </div>
          <div className="pinning-stat-card curatify-stat-card--accent">
            <p className="pinning-stat-value">{planLimitLabel}</p>
            <p className="pinning-stat-label">Plan limit</p>
          </div>
        </div>
      </s-section>

      {!pinningAvailable ? (
        <s-section heading="Why upgrade?">
          <div className="pinning-upsell-grid">
            <div className="pinning-upsell-card">
              <p className="pinning-upsell-title">Growth · 5 pins</p>
              <p className="pinning-upsell-text">
                Keep hero products at the top of key manual collections even
                when other items sell out.
              </p>
            </div>
            <div className="pinning-upsell-card">
              <p className="pinning-upsell-title">Pro · Unlimited</p>
              <p className="pinning-upsell-text">
                Pin as many products as you need across every manual collection.
              </p>
            </div>
            <div className="pinning-upsell-card">
              <p className="pinning-upsell-title">Works with push-down</p>
              <p className="pinning-upsell-text">
                Pinned products stay first; sold-out items still move to the
                bottom automatically.
              </p>
            </div>
          </div>
        </s-section>
      ) : null}

      <s-section heading="Collections" padding="none">
        {collections.length === 0 ? (
          <div className="curatify-empty curatify-empty--compact">
            <p className="curatify-empty-title">No collections synced</p>
            <p className="curatify-empty-text">
              Enable pinning on manual collections once they appear here.
            </p>
          </div>
        ) : (
          <div className="pinning-table-shell">
          <s-table>
            <s-table-header-row>
              <s-table-header>Collection</s-table-header>
              <s-table-header>Product count</s-table-header>
              <s-table-header>Pins used</s-table-header>
              <s-table-header>Plan limit</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {collections.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>
                    <div className="pinning-table-cell">
                      <div>
                        <div className="pinning-collection-title">
                          {row.title}
                        </div>
                      </div>
                    </div>
                  </s-table-cell>
                  <s-table-cell>
                    <div className="pinning-table-cell">{row.productCount}</div>
                  </s-table-cell>
                  <s-table-cell>
                    <div className="pinning-table-cell">{row.pinsUsed}</div>
                  </s-table-cell>
                  <s-table-cell>
                    <div className="pinning-table-cell">
                      {row.planLimitLabel}
                    </div>
                  </s-table-cell>
                  <s-table-cell>
                    <div className="pinning-table-cell">
                      <span className={statusClass(row.status)}>
                        {row.statusLabel}
                      </span>
                    </div>
                  </s-table-cell>
                  <s-table-cell>
                    <div className="pinning-table-cell">
                      <s-button
                        variant="secondary"
                        onClick={() => navigate(`/app/pinning/${row.id}`)}
                      >
                        Manage
                      </s-button>
                    </div>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
