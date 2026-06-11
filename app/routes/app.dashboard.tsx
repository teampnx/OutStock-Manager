import { useEffect, useMemo, type ReactNode } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import type { ActivityFeedItem } from "../lib/activity-format";
import { formatDateTime } from "../lib/format-datetime";
import { getDashboardStats } from "../models/activity-log.server";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import type { loader as activityLoader } from "./app.activity";
import type { loader as collectionsLoader } from "./app.collections";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  let stats = {
    totalTrackedProducts: 0,
    totalTrackedCollections: 0,
    inStockProducts: 0,
    soldOutProducts: 0,
    productsMovedToBottom: 0,
    productsRestored: 0,
    lastSuccessfulSync: null as string | null,
  };

  try {
    const shop = await ensureShop(session.shop);

    try {
      stats = await getDashboardStats(session.shop, shop.id);
    } catch (statsError) {
      console.error(
        `[dashboard] Failed to load statistics for ${session.shop}:`,
        statsError,
      );
    }

    if (!shop.settings) {
      return {
        shopDomain: shop.shopDomain,
        shopName: shop.shopName ?? shop.shopDomain,
        plan: shop.plan,
        settings: null,
        stats,
        error: "Unable to load store settings.",
      };
    }

    return {
      shopDomain: shop.shopDomain,
      shopName: shop.shopName ?? shop.shopDomain,
      plan: shop.plan,
      settings: shop.settings,
      stats,
      error: null,
    };
  } catch (error) {
    console.error(
      `[dashboard] Failed to load dashboard for ${session.shop}:`,
      error,
    );

    return {
      shopDomain: session.shop,
      shopName: session.shop,
      plan: "FREE" as const,
      settings: null,
      stats,
      error: "Something went wrong loading your dashboard.",
    };
  }
};

const KPI_ACCENTS = {
  products: "#5c6ac4",
  collections: "#637381",
  inStock: "#29845a",
  soldOut: "#c5280c",
  moved: "#b98900",
  restored: "#005bd3",
} as const;

function formatRestorePosition(position: string) {
  return position === "TOP" ? "Top of collection" : "Original position";
}

function activityDotClass(tone: ActivityFeedItem["tone"]) {
  switch (tone) {
    case "success":
      return "dashboard-timeline-dot-success";
    case "warning":
      return "dashboard-timeline-dot-warning";
    case "critical":
      return "dashboard-timeline-dot-critical";
    default:
      return "dashboard-timeline-dot-info";
  }
}

function PanelCard({
  title,
  linkHref,
  linkLabel,
  children,
}: {
  title: string;
  linkHref?: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  return (
    <s-box
      padding="none"
      borderWidth="base"
      borderRadius="large"
      background="base"
    >
      <div className="dashboard-panel-header">
        <s-grid
          gridTemplateColumns="1fr auto"
          gap="base"
          alignItems="center"
        >
          <p className="dashboard-panel-title">{title}</p>
          {linkHref && linkLabel ? (
            <s-link href={linkHref}>{linkLabel}</s-link>
          ) : null}
        </s-grid>
      </div>
      {children}
    </s-box>
  );
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <s-box
      padding="large"
      borderWidth="base"
      borderRadius="large"
      background="base"
    >
      <div
        className="dashboard-kpi-accent"
        style={{ borderLeftColor: accent, paddingLeft: 12 }}
      >
        <s-stack direction="block" gap="small-100">
          <p className="dashboard-kpi-value">{value.toLocaleString()}</p>
          <p className="dashboard-kpi-label">{label}</p>
        </s-stack>
      </div>
    </s-box>
  );
}

function HealthMetric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <div className={warning ? "dashboard-health-warning" : undefined}>
      <s-stack direction="block" gap="small-100">
        <p className="dashboard-health-value">{value.toLocaleString()}</p>
        <p className="dashboard-health-label">{label}</p>
      </s-stack>
    </div>
  );
}

function StatusItem({ label, active }: { label: string; active: boolean }) {
  return (
    <s-stack direction="inline" gap="small-100" alignItems="center">
      <s-icon
        type={active ? "check-circle-filled" : "disabled"}
        {...(active ? { tone: "success" } : { color: "subdued" })}
      />
      <s-text>{label}</s-text>
    </s-stack>
  );
}

function ActivityTimelineItem({ entry }: { entry: ActivityFeedItem }) {
  return (
    <div className="dashboard-timeline-item">
      <span
        className={`dashboard-timeline-dot ${activityDotClass(entry.tone)}`}
      />
      <div className="dashboard-timeline-main">
        <p className="dashboard-timeline-title">{entry.title}</p>
        <p className="dashboard-timeline-description">{entry.description}</p>
      </div>
      <p className="dashboard-timeline-time">
        {formatDateTime(entry.occurredAt)}
      </p>
    </div>
  );
}

export default function Dashboard() {
  const { shopName, plan, settings, stats, error } =
    useLoaderData<typeof loader>();
  const activityFetcher = useFetcher<typeof activityLoader>();
  const collectionsFetcher = useFetcher<typeof collectionsLoader>();

  const isEnabled = settings?.enabled ?? false;

  useEffect(() => {
    activityFetcher.load("/app/activity");
    collectionsFetcher.load("/app/collections");
  }, []);

  const recentActivity = (activityFetcher.data?.activity ?? []).slice(0, 8);
  const activityLoading =
    activityFetcher.state !== "idle" && !activityFetcher.data?.activity;

  const collectionCounts = collectionsFetcher.data?.counts;
  const collections = collectionsFetcher.data?.collections ?? [];
  const manualSortableCount = collections.filter(
    (collection) => collection.sortOrder === "MANUAL",
  ).length;
  const collectionsNeedingAttention = useMemo(
    () =>
      collections.filter(
        (collection) =>
          collection.enabled &&
          (collection.sortBlockedReason != null ||
            collection.sortStatus.state === "failed"),
      ).length,
    [collections],
  );
  const collectionsLoading =
    collectionsFetcher.state !== "idle" && !collectionsFetcher.data?.counts;

  const heroDescription = isEnabled
    ? "Automatically keeps sold-out products at the bottom of your manual collections."
    : "Enable the app in Settings to start automatic sold-out sorting.";

  return (
    <s-page heading="Dashboard" inlineSize="large">
      <s-link slot="primary-action" href="/app/settings">
        Settings
      </s-link>

      {error && (
        <s-banner tone="critical" heading="Unable to load dashboard">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      <s-stack direction="block" gap="large">
        {/* Row 1: Hero */}
        <s-box
          padding="large"
          borderWidth="base"
          borderRadius="large"
          background="base"
        >
          <s-stack direction="block" gap="base">
            <s-grid
              gridTemplateColumns="1fr auto"
              gap="base"
              alignItems="start"
            >
              <s-stack direction="block" gap="small-200">
                <p className="dashboard-hero-title">OutStock Manager</p>
                <s-paragraph>
                  <s-text color="subdued">{heroDescription}</s-text>
                </s-paragraph>
                <s-paragraph>
                  <s-text color="subdued">
                    {shopName} · Last sync{" "}
                    {formatDateTime(stats.lastSuccessfulSync)}
                  </s-text>
                </s-paragraph>
              </s-stack>
              <s-badge tone={isEnabled ? "success" : "warning"} size="large">
                {isEnabled ? "Running" : "Paused"}
              </s-badge>
            </s-grid>

            <div className="dashboard-hero-metrics">
              <span className="dashboard-hero-metric">
                <strong>{stats.totalTrackedProducts.toLocaleString()}</strong>{" "}
                products tracked
              </span>
              <span className="dashboard-hero-metric">
                <strong>{stats.totalTrackedCollections.toLocaleString()}</strong>{" "}
                collections
              </span>
              <span className="dashboard-hero-metric">
                <strong>{stats.soldOutProducts.toLocaleString()}</strong> sold out
              </span>
              <span className="dashboard-hero-metric">
                <strong>{stats.productsMovedToBottom.toLocaleString()}</strong>{" "}
                moved to bottom
              </span>
            </div>
          </s-stack>
        </s-box>

        {/* Row 2: KPI cards */}
        <s-grid gap="base" gridTemplateColumns="1fr 1fr 1fr">
          <KpiCard
            label="Tracked Products"
            value={stats.totalTrackedProducts}
            accent={KPI_ACCENTS.products}
          />
          <KpiCard
            label="Tracked Collections"
            value={stats.totalTrackedCollections}
            accent={KPI_ACCENTS.collections}
          />
          <KpiCard
            label="In Stock"
            value={stats.inStockProducts}
            accent={KPI_ACCENTS.inStock}
          />
          <KpiCard
            label="Sold Out"
            value={stats.soldOutProducts}
            accent={KPI_ACCENTS.soldOut}
          />
          <KpiCard
            label="Moved To Bottom"
            value={stats.productsMovedToBottom}
            accent={KPI_ACCENTS.moved}
          />
          <KpiCard
            label="Restored"
            value={stats.productsRestored}
            accent={KPI_ACCENTS.restored}
          />
        </s-grid>

        {/* Row 3: Activity + sidebar */}
        <s-grid gap="base" gridTemplateColumns="2fr 1fr" alignItems="start">
          <PanelCard
            title="Recent Activity"
            linkHref="/app/activity"
            linkLabel="View all"
          >
            <s-box padding="none">
              {activityLoading ? (
                <s-box padding="large">
                  <s-stack direction="inline" justifyContent="center">
                    <s-spinner
                      accessibilityLabel="Loading activity"
                      size="base"
                    />
                  </s-stack>
                </s-box>
              ) : recentActivity.length === 0 ? (
                <s-box padding="large">
                  <s-paragraph>
                    <s-text color="subdued">
                      No activity recorded yet. Product moves, restores, and
                      syncs will appear here.
                    </s-text>
                  </s-paragraph>
                </s-box>
              ) : (
                <div className="dashboard-timeline">
                  {recentActivity.map((entry) => (
                    <ActivityTimelineItem key={entry.id} entry={entry} />
                  ))}
                </div>
              )}
            </s-box>
          </PanelCard>

          <s-stack direction="block" gap="base">
            <PanelCard title="System Status">
              <s-box padding="base">
                <s-stack direction="block" gap="small">
                  <StatusItem label="App Enabled" active={isEnabled} />
                  <StatusItem label="Webhooks Active" active={isEnabled} />
                  <StatusItem label="Worker Running" active={isEnabled} />
                  <StatusItem
                    label="Collection Sync Active"
                    active={Boolean(stats.lastSuccessfulSync)}
                  />
                </s-stack>
              </s-box>
            </PanelCard>

            <PanelCard
              title="Collection Health"
              linkHref="/app/collections"
              linkLabel="Manage"
            >
              <s-box padding="base">
                {collectionsLoading ? (
                  <s-stack direction="inline" justifyContent="center">
                    <s-spinner
                      accessibilityLabel="Loading collection health"
                      size="base"
                    />
                  </s-stack>
                ) : (
                  <s-grid gap="base" gridTemplateColumns="1fr 1fr">
                    <HealthMetric
                      label="Enabled collections"
                      value={collectionCounts?.enabled ?? 0}
                    />
                    <HealthMetric
                      label="Disabled collections"
                      value={collectionCounts?.disabled ?? 0}
                    />
                    <HealthMetric
                      label="Sortable collections"
                      value={manualSortableCount}
                    />
                    <HealthMetric
                      label="Requiring attention"
                      value={collectionsNeedingAttention}
                      warning={collectionsNeedingAttention > 0}
                    />
                  </s-grid>
                )}
              </s-box>
            </PanelCard>

            <PanelCard title="Quick Actions">
              <s-box padding="base">
                <s-stack direction="block" gap="small-100">
                  <s-button href="/app/collections" icon="sort">
                    Sort Enabled Collections
                  </s-button>
                  <s-button href="/app/collections" variant="secondary" icon="collection-list">
                    Collections
                  </s-button>
                  <s-button href="/app/activity" variant="secondary" icon="list-bulleted">
                    Activity Log
                  </s-button>
                  <s-button href="/app/settings" variant="secondary" icon="settings">
                    Settings
                  </s-button>
                </s-stack>
              </s-box>
            </PanelCard>
          </s-stack>
        </s-grid>

        {/* Row 4: Store overview */}
        <PanelCard title="Store Overview">
          <s-box padding="base" background="subdued">
            <s-grid gap="large" gridTemplateColumns="1fr 1fr 1fr">
              <s-stack direction="block" gap="small-100">
                <s-text color="subdued">Store</s-text>
                <s-text type="strong">{shopName}</s-text>
              </s-stack>
              <s-stack direction="block" gap="small-100">
                <s-text color="subdued">Plan</s-text>
                <s-text type="strong">{plan}</s-text>
              </s-stack>
              <s-stack direction="block" gap="small-100">
                <s-text color="subdued">App status</s-text>
                <s-badge tone={isEnabled ? "success" : "warning"}>
                  {isEnabled ? "Enabled" : "Disabled"}
                </s-badge>
              </s-stack>
              {settings ? (
                <>
                  <s-stack direction="block" gap="small-100">
                    <s-text color="subdued">Push sold out to bottom</s-text>
                    <s-text type="strong">
                      {settings.pushSoldOutToBottom ? "On" : "Off"}
                    </s-text>
                  </s-stack>
                  <s-stack direction="block" gap="small-100">
                    <s-text color="subdued">Restore when back in stock</s-text>
                    <s-text type="strong">
                      {settings.restoreWhenBackInStock ? "On" : "Off"}
                    </s-text>
                  </s-stack>
                  <s-stack direction="block" gap="small-100">
                    <s-text color="subdued">Restore position</s-text>
                    <s-text type="strong">
                      {settings.restoreWhenBackInStock
                        ? formatRestorePosition(settings.restorePosition)
                        : "—"}
                    </s-text>
                  </s-stack>
                </>
              ) : null}
            </s-grid>
          </s-box>
        </PanelCard>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
