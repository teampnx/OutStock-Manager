import { useMemo, useState, type ReactNode } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  APP_NAME,
  APP_NAME_SHORT,
  APP_TAGLINE,
  SUPPORT_EMAIL,
  pageTitle,
} from "../lib/branding";
import { getDashboardStats } from "../models/activity-log.server";
import { listCollectionManagementForShop } from "../models/collection-management.server";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";

export function meta() {
  return [{ title: pageTitle("Home") }];
}

type SetupStep = {
  id: string;
  label: string;
  completed: boolean;
  actionHref?: string;
  actionLabel?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  let stats = {
    totalTrackedProducts: 0,
    totalTrackedCollections: 0,
    soldOutProducts: 0,
    productsMovedToBottom: 0,
    lastSuccessfulSync: null as string | null,
  };
  let enabledCollections = 0;
  let hasSortedCollection = false;

  try {
    const shop = await ensureShop(session.shop);

    try {
      const dashboardStats = await getDashboardStats(session.shop, shop.id);
      stats = {
        totalTrackedProducts: dashboardStats.totalTrackedProducts,
        totalTrackedCollections: dashboardStats.totalTrackedCollections,
        soldOutProducts: dashboardStats.soldOutProducts,
        productsMovedToBottom: dashboardStats.productsMovedToBottom,
        lastSuccessfulSync: dashboardStats.lastSuccessfulSync,
      };
    } catch (statsError) {
      console.error(
        `[onboarding] Failed to load statistics for ${session.shop}:`,
        statsError,
      );
    }

    try {
      const collectionData = await listCollectionManagementForShop(
        session.shop,
        admin,
      );
      enabledCollections = collectionData.counts.enabled;
      hasSortedCollection = collectionData.collections.some(
        (collection) => collection.sortStatus.lastSortedAt != null,
      );
    } catch (collectionsError) {
      console.error(
        `[onboarding] Failed to load collections for ${session.shop}:`,
        collectionsError,
      );
    }

    return {
      shopName: shop.shopName ?? shop.shopDomain,
      settings: shop.settings,
      stats,
      enabledCollections,
      hasSortedCollection,
      error: shop.settings ? null : "Unable to load store settings.",
    };
  } catch (error) {
    console.error(
      `[onboarding] Failed to load welcome page for ${session.shop}:`,
      error,
    );

    return {
      shopName: session.shop,
      settings: null,
      stats,
      enabledCollections,
      hasSortedCollection,
      error: "Something went wrong loading your welcome page.",
    };
  }
};

function PanelCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="curatify-section-card">
      <div className="home-panel-header">
        <p className="home-panel-title">{title}</p>
      </div>
      {children}
    </div>
  );
}

function SetupStepItem({
  step,
  index,
}: {
  step: SetupStep;
  index: number;
}) {
  return (
    <div className="home-setup-item">
      <div
        className={`home-setup-step-marker ${
          step.completed
            ? "home-setup-step-marker-complete"
            : "home-setup-step-marker-pending"
        }`}
      >
        {step.completed ? (
          <s-icon type="check" tone="success" size="small" />
        ) : (
          index + 1
        )}
      </div>
      <p
        className={`home-setup-step-label ${
          step.completed ? "home-setup-step-label-complete" : ""
        }`}
      >
        {step.label}
      </p>
      {!step.completed && step.actionHref && step.actionLabel ? (
        <s-link href={step.actionHref}>{step.actionLabel}</s-link>
      ) : step.completed ? (
        <s-badge tone="success">Done</s-badge>
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="curatify-kpi-card">
      <s-stack direction="block" gap="small-100">
        <p className="home-stat-value">{value.toLocaleString()}</p>
        <p className="home-stat-label">{label}</p>
      </s-stack>
    </div>
  );
}

function HelpLink({
  href,
  icon,
  label,
  description,
}: {
  href: string;
  icon: "email" | "book" | "calendar";
  label: string;
  description: string;
}) {
  return (
    <a
      className="home-help-link"
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noreferrer" : undefined}
    >
      <s-icon type={icon} color="subdued" />
      <s-stack direction="block" gap="small-100">
        <s-text type="strong">{label}</s-text>
        <s-text color="subdued">{description}</s-text>
      </s-stack>
    </a>
  );
}

export default function Onboarding() {
  const {
    shopName,
    settings,
    stats,
    enabledCollections,
    hasSortedCollection,
    error,
  } = useLoaderData<typeof loader>();
  const [videoAcknowledged, setVideoAcknowledged] = useState(false);

  const isAppEnabled = settings?.enabled ?? false;
  const hasRunFirstSort =
    stats.lastSuccessfulSync != null ||
    stats.productsMovedToBottom > 0 ||
    hasSortedCollection;

  const setupSteps = useMemo<SetupStep[]>(
    () => [
      {
        id: "install",
        label: "Install App",
        completed: true,
      },
      {
        id: "enable-app",
        label: "Enable App",
        completed: isAppEnabled,
        actionHref: "/app/settings",
        actionLabel: "Open Settings",
      },
      {
        id: "enable-push-down",
        label: "Enable Push Down on a collection",
        completed: enabledCollections > 0,
        actionHref: "/app/collections",
        actionLabel: "Open Collections",
      },
      {
        id: "first-sort",
        label: "Run first collection sort",
        completed: hasRunFirstSort,
        actionHref: "/app/collections",
        actionLabel: "Sort collections",
      },
    ],
    [enabledCollections, hasRunFirstSort, isAppEnabled],
  );

  const completedSteps = setupSteps.filter((step) => step.completed).length;
  const totalSteps = setupSteps.length;
  const progressPercent = Math.round((completedSteps / totalSteps) * 100);
  const onboardingComplete = completedSteps === totalSteps;

  return (
    <s-page heading={APP_NAME} inlineSize="large">
      <s-link slot="primary-action" href="/app/dashboard">
        View Dashboard
      </s-link>

      {error && (
        <s-banner tone="critical" heading="Unable to load welcome page">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      <s-stack direction="block" gap="large">
        <div className="curatify-hero">
          <s-stack direction="block" gap="small-200">
            <p className="home-hero-title">{APP_NAME_SHORT}</p>
            <p className="home-hero-subtitle">{APP_TAGLINE}</p>
            <p className="home-hero-description">
              {onboardingComplete
                ? `${shopName} is set up and sorting sold-out products automatically.`
                : `Finish setup for ${shopName} to start pushing sold-out products to the bottom of your collections.`}
            </p>
          </s-stack>
        </div>

        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))"
          gap="large"
        >
          <PanelCard title="Setup progress">
            <s-box padding="base">
              <s-stack direction="block" gap="base">
                <s-stack direction="block" gap="small-100">
                  <s-grid
                    gridTemplateColumns="1fr auto"
                    gap="small-200"
                    alignItems="center"
                  >
                    <p className="home-progress-label">
                      {completedSteps} of {totalSteps} steps complete
                    </p>
                    <s-badge tone={onboardingComplete ? "success" : "info"}>
                      {progressPercent}%
                    </s-badge>
                  </s-grid>
                  <div className="home-progress-track">
                    <div
                      className="home-progress-fill"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </s-stack>

                <div className="home-setup-list">
                  {setupSteps.map((step, index) => (
                    <SetupStepItem key={step.id} step={step} index={index} />
                  ))}
                </div>
              </s-stack>
            </s-box>
          </PanelCard>

          <PanelCard title="Product demo">
            <s-box padding="base">
              <s-stack direction="block" gap="base">
                <div className="home-video-placeholder">
                  <button
                    type="button"
                    className="home-video-play"
                    aria-label="Play demo video"
                    onClick={() => setVideoAcknowledged(true)}
                  >
                    <s-icon type="play" tone="info" />
                  </button>
                </div>
                {videoAcknowledged ? (
                  <s-banner tone="info">
                    Demo video coming soon. Use the setup checklist to get
                    started in the meantime.
                  </s-banner>
                ) : null}
                <p className="home-video-description">
                  Watch a quick walkthrough of enabling Push Down, choosing
                  collections, and running your first automatic sort.
                </p>
              </s-stack>
            </s-box>
          </PanelCard>
        </s-grid>

        <s-stack direction="block" gap="small-200">
          <p className="home-panel-title">Quick stats</p>
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
            gap="base"
          >
            <StatCard
              label="Products tracked"
              value={stats.totalTrackedProducts}
            />
            <StatCard
              label="Collections tracked"
              value={stats.totalTrackedCollections}
            />
            <StatCard
              label="Push Down enabled collections"
              value={enabledCollections}
            />
            <StatCard label="Sold out products" value={stats.soldOutProducts} />
          </s-grid>
        </s-stack>

        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))"
          gap="large"
        >
          <PanelCard title="Quick actions">
            <s-box padding="base">
              <s-stack direction="block" gap="small-200">
                <s-button href="/app/collections" icon="collection-list">
                  Open Collections
                </s-button>
                <s-button href="/app/activity" variant="secondary" icon="list-bulleted">
                  View Activity
                </s-button>
                <s-button href="/app/settings" variant="secondary" icon="settings">
                  Open Settings
                </s-button>
                <s-button href="/app/collections" variant="secondary" icon="sort">
                  Sort Enabled Collections
                </s-button>
              </s-stack>
            </s-box>
          </PanelCard>

          <PanelCard title="Help &amp; support">
            <s-box padding="base">
              <HelpLink
                href={`mailto:${SUPPORT_EMAIL}`}
                icon="email"
                label="Contact support"
                description="Get help from our team within one business day."
              />
              <HelpLink
                href="https://shopify.dev/docs/apps"
                icon="book"
                label="Documentation"
                description="Read setup guides and troubleshooting tips."
              />
              <HelpLink
                href="https://calendly.com"
                icon="calendar"
                label="Book demo call"
                description="Schedule a 15-minute walkthrough with our team."
              />
            </s-box>
          </PanelCard>
        </s-grid>

        {onboardingComplete ? (
          <s-box
            padding="large"
            borderWidth="base"
            borderRadius="large"
            background="base"
          >
            <s-grid
              gridTemplateColumns="1fr auto"
              gap="base"
              alignItems="center"
            >
              <s-stack direction="block" gap="small-200">
                <s-stack direction="inline" gap="small-100" alignItems="center">
                  <div className="home-review-stars" aria-hidden="true">
                    <s-icon type="star-filled" tone="warning" />
                    <s-icon type="star-filled" tone="warning" />
                    <s-icon type="star-filled" tone="warning" />
                    <s-icon type="star-filled" tone="warning" />
                    <s-icon type="star-filled" tone="warning" />
                  </div>
                  <s-text type="strong">Enjoying {APP_NAME_SHORT}?</s-text>
                </s-stack>
                <s-text color="subdued">
                  Your store is fully set up. A quick review on the Shopify App
                  Store helps other merchants discover automatic sold-out sorting.
                </s-text>
              </s-stack>
              <s-button
                href="https://apps.shopify.com"
                target="_blank"
                variant="primary"
              >
                Leave a review
              </s-button>
            </s-grid>
          </s-box>
        ) : null}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
