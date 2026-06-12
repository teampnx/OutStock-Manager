import { useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { Prisma } from "@prisma/client";

import { resetPrismaClient } from "../db.server";
import { formatStoreDateTime } from "../lib/format-datetime";
import { PlanLimitError } from "../lib/plan-enforcement.server";
import { enqueueBackfillSoldOutProducts } from "../models/collection-reorder.server";
import {
  listCollectionManagementForShop,
  SetCollectionEnabledError,
  setCollectionEnabled,
  type CollectionManagementItem,
} from "../models/collection-management.server";
import {
  enqueueCollectionSortRetry,
  shopHasActiveCollectionSortJobs,
  type CollectionSortStatus,
} from "../models/collection-sort-status.server";
import {
  CollectionPreviewModal,
  showCollectionPreviewModal,
} from "../components/CollectionPreviewModal";
import { authenticate } from "../shopify.server";
import styles from "../styles/collections.module.css";
import type { loader as collectionDetailsLoader } from "./app.collections.$id";

type CollectionTab = "all" | "enabled";
type TitleSort = "default" | "asc" | "desc";

function formatLoaderError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isStalePrismaClientError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientValidationError &&
    (error.message.includes("Unknown argument `enabled`") ||
      error.message.includes("Unknown argument `lastSortedAt`") ||
      error.message.includes("Unknown argument `enabledAt`") ||
      error.message.includes("Unknown argument `lastSortAttemptAt`"))
  );
}

async function loadCollectionsWithRetry(
  shop: string,
  admin: Parameters<typeof listCollectionManagementForShop>[1],
) {
  try {
    return await listCollectionManagementForShop(shop, admin);
  } catch (error) {
    if (!isStalePrismaClientError(error)) {
      throw error;
    }

    console.warn(
      `[collections] Stale Prisma client detected for ${shop}; resetting client and retrying once`,
    );
    resetPrismaClient();
    return listCollectionManagementForShop(shop, admin);
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  console.log(`[collections] Loading collections for ${session.shop}`);

  try {
    const [data, hasActiveSortJobs] = await Promise.all([
      loadCollectionsWithRetry(session.shop, admin),
      shopHasActiveCollectionSortJobs(session.shop),
    ]);
    console.log(
      `[collections] Loaded ${data.counts.all} collections for ${session.shop} ` +
        `(enabled=${data.counts.enabled}, disabled=${data.counts.disabled})`,
    );
    return { ...data, hasActiveSortJobs, error: null, errorDetail: null };
  } catch (error) {
    const errorDetail = formatLoaderError(error);
    console.error(
      `[collections] Failed to load collections for ${session.shop}:`,
      error,
    );
    return {
      collections: [],
      counts: { all: 0, enabled: 0, disabled: 0 },
      hasActiveSortJobs: false,
      error: "Could not load collections. Please refresh the page.",
      errorDetail,
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle-enabled") {
    const collectionId = String(formData.get("collectionId") ?? "");
    const enabled = formData.get("enabled") === "true";

    if (!collectionId) {
      return { success: false as const, error: "Missing collection id." };
    }

    try {
      const updated = await setCollectionEnabled(
        session.shop,
        collectionId,
        enabled,
        admin,
      );

      if (!updated) {
        return { success: false as const, error: "Collection not found." };
      }

      return {
        success: true as const,
        intent: "toggle-enabled" as const,
        sortBlockedReason: updated.sortBlockedReason,
      };
    } catch (error) {
      console.error(
        `[collections] Failed to toggle enabled for ${collectionId}:`,
        error,
      );
      return {
        success: false as const,
        error:
          error instanceof SetCollectionEnabledError
            ? error.message
            : error instanceof PlanLimitError
              ? error.message
              : "Could not update collection status.",
      };
    }
  }

  if (intent === "trigger-sorting") {
    try {
      const job = await enqueueBackfillSoldOutProducts(session.shop);
      console.log(
        `[collections] Enqueued BACKFILL_SOLD_OUT_PRODUCTS job=${job.id} ` +
          `status=${job.status} shop=${session.shop}`,
      );
      return {
        success: true as const,
        intent: "trigger-sorting" as const,
        jobId: job.id,
      };
    } catch (error) {
      console.error(
        `[collections] Failed to enqueue BACKFILL_SOLD_OUT_PRODUCTS for ${session.shop}:`,
        error,
      );
      return {
        success: false as const,
        error: "Could not trigger sorting for enabled collections.",
      };
    }
  }

  if (intent === "retry-collection-sort") {
    const collectionId = String(formData.get("collectionId") ?? "");

    if (!collectionId) {
      return { success: false as const, error: "Missing collection id." };
    }

    const queued = await enqueueCollectionSortRetry(session.shop, collectionId);

    if (!queued) {
      return {
        success: false as const,
        error: "Could not retry sorting for this collection.",
      };
    }

    return {
      success: true as const,
      intent: "retry-collection-sort" as const,
      collectionId,
    };
  }

  return { success: false as const, error: "Unknown action." };
};

function resolveSortDisplay(
  sortStatus: CollectionSortStatus,
  optimisticInProgress: boolean,
): {
  state: CollectionSortStatus["state"] | "in_progress";
  lastSortedAt: string | null;
} {
  if (optimisticInProgress || sortStatus.state === "in_progress") {
    return {
      state: "in_progress",
      lastSortedAt: sortStatus.lastSortedAt,
    };
  }

  return {
    state: sortStatus.state,
    lastSortedAt: sortStatus.lastSortedAt,
  };
}

function LastSortedAtCell({
  sortStatus,
  sortBlockedReason,
  optimisticInProgress,
}: {
  sortStatus: CollectionSortStatus;
  sortBlockedReason: string | null;
  optimisticInProgress: boolean;
}) {
  if (sortBlockedReason) {
    return (
      <s-text color="subdued">Requires Manual sort</s-text>
    );
  }

  const display = resolveSortDisplay(sortStatus, optimisticInProgress);

  if (display.state === "in_progress") {
    return (
      <s-stack direction="inline" gap="small-100" alignItems="center">
        <s-spinner accessibilityLabel="Sorting in progress" size="base" />
        <s-text color="subdued">Sorting in progress</s-text>
      </s-stack>
    );
  }

  if (display.state === "failed") {
    return <s-badge tone="critical">Sorting failed</s-badge>;
  }

  if (display.state === "completed" && display.lastSortedAt) {
    return (
      <s-text color="subdued">{formatStoreDateTime(display.lastSortedAt)}</s-text>
    );
  }

  return <s-text color="subdued">Never</s-text>;
}

function CollectionThumbnail({
  title,
  imageUrl,
  imageAlt,
}: {
  title: string;
  imageUrl: string | null;
  imageAlt: string | null;
}) {
  if (imageUrl) {
    return (
      <s-thumbnail src={imageUrl} alt={imageAlt ?? title} size="base" />
    );
  }

  return (
    <div className={styles.collectionPlaceholder} aria-hidden="true">
      <s-icon type="image-none" size="small" color="subdued" />
    </div>
  );
}

function SortRuleSelect({
  sortOrder,
  label,
}: {
  sortOrder: string;
  label: string;
}) {
  return (
    <div className={styles.compactSelect}>
      <s-select
        label="Applied sorting rule"
        labelAccessibilityVisibility="exclusive"
        value={sortOrder}
        disabled
      >
        <s-option value={sortOrder}>{label}</s-option>
      </s-select>
    </div>
  );
}

function PushDownStatusSelect({
  collection,
  isToggling,
  onToggle,
}: {
  collection: CollectionManagementItem;
  isToggling: boolean;
  onToggle: (collectionId: string, enabled: boolean) => void;
}) {
  const enabled = collection.enabled;

  return (
    <div
      className={
        enabled ? styles.statusSelectEnabled : styles.statusSelectDisabled
      }
    >
      <s-select
        label="Push down status"
        labelAccessibilityVisibility="exclusive"
        value={enabled ? "enabled" : "disabled"}
        icon={enabled ? "check-circle-filled" : "disabled"}
        disabled={isToggling}
        onChange={(event) => {
          const nextEnabled = event.currentTarget.value === "enabled";
          if (nextEnabled !== enabled) {
            onToggle(collection.id, nextEnabled);
          }
        }}
      >
        <s-option value="enabled">Enabled</s-option>
        <s-option value="disabled">Disabled</s-option>
      </s-select>
    </div>
  );
}

function CollectionTableRow({
  collection,
  onToggle,
  onRetry,
  onPreview,
  isToggling,
  isRetrying,
  optimisticInProgress,
}: {
  collection: CollectionManagementItem;
  onToggle: (collectionId: string, enabled: boolean) => void;
  onRetry: (collectionId: string) => void;
  onPreview: (collectionId: string) => void;
  isToggling: boolean;
  isRetrying: boolean;
  optimisticInProgress: boolean;
}) {
  const showRetry =
    collection.sortStatus.state === "failed" && collection.enabled;
  const previewLinkId = `collection-preview-${collection.id}`;

  return (
    <s-table-row clickDelegate={previewLinkId}>
      <s-table-cell>
        <div className={`${styles.tableCellContent} ${styles.collectionCell}`}>
          <CollectionThumbnail
            title={collection.title}
            imageUrl={collection.imageUrl}
            imageAlt={collection.imageAlt}
          />
          <s-stack direction="block" gap="small-100">
            <s-link href={`/app/collections/${collection.id}`}>
              {collection.title}
            </s-link>
            <s-text color="subdued">
              {collection.productCount}{" "}
              {collection.productCount === 1 ? "product" : "products"}
            </s-text>
          </s-stack>
        </div>
      </s-table-cell>
      <s-table-cell>
        <div className={styles.tableCellContent}>
          <SortRuleSelect
            sortOrder={collection.sortOrder}
            label={collection.sortOrderLabel}
          />
        </div>
      </s-table-cell>
      <s-table-cell>
        <div className={styles.tableCellContent}>
          <PushDownStatusSelect
            collection={collection}
            isToggling={isToggling}
            onToggle={onToggle}
          />
        </div>
      </s-table-cell>
      <s-table-cell>
        <div className={styles.tableCellContent}>
          <LastSortedAtCell
            sortStatus={collection.sortStatus}
            sortBlockedReason={collection.sortBlockedReason}
            optimisticInProgress={optimisticInProgress}
          />
        </div>
      </s-table-cell>
      <s-table-cell>
        <div className={styles.tableCellContent}>
          <s-stack direction="inline" gap="small-100" alignItems="center">
            <s-button
              id={previewLinkId}
              variant="secondary"
              onClick={() => onPreview(collection.id)}
            >
              Preview
            </s-button>
            {showRetry ? (
              <s-button
                variant="tertiary"
                icon="refresh"
                accessibilityLabel={`Retry sort for ${collection.title}`}
                onClick={() => onRetry(collection.id)}
                {...(isRetrying ? { loading: true } : {})}
                disabled={isRetrying}
              />
            ) : null}
          </s-stack>
        </div>
      </s-table-cell>
    </s-table-row>
  );
}

export default function CollectionsPage() {
  const { collections, counts, error, hasActiveSortJobs } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const previewFetcher = useFetcher<typeof collectionDetailsLoader>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [tab, setTab] = useState<CollectionTab>("all");
  const [titleSort, setTitleSort] = useState<TitleSort>("default");
  const [optimisticSortingIds, setOptimisticSortingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [previewCollectionId, setPreviewCollectionId] = useState<string | null>(
    null,
  );
  const togglingId =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "toggle-enabled"
      ? String(fetcher.formData.get("collectionId") ?? "")
      : "";

  const retryingId =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "retry-collection-sort"
      ? String(fetcher.formData.get("collectionId") ?? "")
      : "";

  const filteredCollections = useMemo(() => {
    const query = search.trim().toLowerCase();

    let result = collections.filter((collection) => {
      if (tab === "enabled" && !collection.enabled) {
        return false;
      }
      if (!query) {
        return true;
      }
      return collection.title.toLowerCase().includes(query);
    });

    if (titleSort === "asc") {
      result = [...result].sort((a, b) => a.title.localeCompare(b.title));
    } else if (titleSort === "desc") {
      result = [...result].sort((a, b) => b.title.localeCompare(a.title));
    }

    return result;
  }, [collections, search, tab, titleSort]);

  const manualSortableCount = useMemo(
    () => collections.filter((collection) => collection.sortOrder === "MANUAL").length,
    [collections],
  );

  const handleToggle = (collectionId: string, enabled: boolean) => {
    fetcher.submit(
      {
        intent: "toggle-enabled",
        collectionId,
        enabled: String(enabled),
      },
      { method: "post" },
    );
  };

  const handleRetry = (collectionId: string) => {
    setOptimisticSortingIds((current) => new Set(current).add(collectionId));
    fetcher.submit(
      {
        intent: "retry-collection-sort",
        collectionId,
      },
      { method: "post" },
    );
  };

  const handleTriggerSorting = () => {
    const enabledIds = collections
      .filter((collection) => collection.enabled)
      .map((collection) => collection.id);
    setOptimisticSortingIds(new Set(enabledIds));
    fetcher.submit({ intent: "trigger-sorting" }, { method: "post" });
  };

  const handleSortToggle = () => {
    setTitleSort((current) => {
      if (current === "default") {
        return "asc";
      }
      if (current === "asc") {
        return "desc";
      }
      return "default";
    });
  };

  const handleSearchInput = (value: string) => {
    setSearch(value);
    if (value.trim()) {
      setSearchOpen(true);
    }
  };

  const handlePreview = (collectionId: string) => {
    setPreviewCollectionId(collectionId);
    previewFetcher.load(`/app/collections/${collectionId}`);
    showCollectionPreviewModal();
  };

  const handleClosePreview = () => {
    setPreviewCollectionId(null);
  };

  const previewListItem = previewCollectionId
    ? collections.find((item) => item.id === previewCollectionId)
    : undefined;

  const previewModalCollection =
    previewFetcher.data?.collection?.id === previewCollectionId
      ? {
          title: previewFetcher.data.collection.title,
          productCount: previewFetcher.data.collection.productCount,
          products: previewFetcher.data.collection.products,
        }
      : previewListItem
        ? {
            title: previewListItem.title,
            productCount: previewListItem.productCount,
            products: [],
          }
        : null;

  const previewError =
    previewCollectionId &&
    previewFetcher.state === "idle" &&
    previewFetcher.data &&
    (previewFetcher.data.error ||
      (!previewFetcher.data.collection &&
        previewFetcher.data !== undefined))
      ? previewFetcher.data.error ?? "Collection not found."
      : null;

  useEffect(() => {
    if (!searchOpen) {
      return;
    }

    document.getElementById("collections-search-field")?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.intent === "toggle-enabled") {
      if (fetcher.data.sortBlockedReason) {
        shopify.toast.show(fetcher.data.sortBlockedReason, { isError: true });
      } else {
        shopify.toast.show("Collection status updated");
      }
    } else if (
      fetcher.data?.success &&
      fetcher.data.intent === "trigger-sorting"
    ) {
      shopify.toast.show("Sorting started for enabled collections");
      revalidator.revalidate();
    } else if (
      fetcher.data?.success &&
      fetcher.data.intent === "retry-collection-sort"
    ) {
      shopify.toast.show("Sorting retry started");
      revalidator.revalidate();
    }
  }, [fetcher.data, revalidator, shopify]);

  useEffect(() => {
    if (!hasActiveSortJobs && optimisticSortingIds.size === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      revalidator.revalidate();
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [hasActiveSortJobs, optimisticSortingIds.size, revalidator]);

  useEffect(() => {
    if (hasActiveSortJobs || fetcher.state !== "idle") {
      return;
    }

    setOptimisticSortingIds((current) => {
      if (current.size === 0) {
        return current;
      }

      const next = new Set(current);
      for (const collection of collections) {
        if (collection.sortStatus.state !== "in_progress") {
          next.delete(collection.id);
        }
      }
      return next.size === current.size ? current : next;
    });
  }, [collections, fetcher.state, hasActiveSortJobs]);

  const isTriggering =
    fetcher.formData?.get("intent") === "trigger-sorting" &&
    fetcher.state !== "idle";

  const tableLoading =
    fetcher.state !== "idle" &&
    (fetcher.formData?.get("intent") === "toggle-enabled" ||
      fetcher.formData?.get("intent") === "trigger-sorting");

  const sortAccessibilityLabel =
    titleSort === "asc"
      ? "Sort collections Z–A"
      : titleSort === "desc"
        ? "Clear collection sort"
        : "Sort collections A–Z";

  return (
    <s-page heading="Collections" inlineSize="large">
      <s-button
        slot="primary-action"
        onClick={handleTriggerSorting}
        {...(isTriggering ? { loading: true } : {})}
        disabled={isTriggering}
      >
        Sort enabled collections
      </s-button>

      {error && (
        <s-banner tone="critical" heading="Unable to load collections">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      {fetcher.data?.success === false && (
        <s-banner tone="critical" heading="Action failed">
          <s-paragraph>{fetcher.data.error}</s-paragraph>
        </s-banner>
      )}

      <s-stack direction="block" gap="large">
        <div className={styles.pageIntro}>
          <s-stack direction="block" gap="small-100">
            <p className="page-intro-title">Manage collection sorting</p>
            <p className="page-intro-text">
              Enable push-down sorting on manual collections to keep sold-out
              products at the bottom. Preview order, retry failed sorts, and
              trigger a full sort for all enabled collections.
            </p>
          </s-stack>
        </div>

        {collections.length > 0 ? (
          <div className={styles.statsBar}>
            <div className={styles.statCard}>
              <p className="stat-card-value">{counts.all}</p>
              <p className="stat-card-label">Total collections</p>
            </div>
            <div className={`${styles.statCard} stat-card-accent-success`}>
              <p className="stat-card-value">{counts.enabled}</p>
              <p className="stat-card-label">Push down enabled</p>
            </div>
            <div className={styles.statCard}>
              <p className="stat-card-value">{counts.disabled}</p>
              <p className="stat-card-label">Disabled</p>
            </div>
            <div className={`${styles.statCard} stat-card-accent-info`}>
              <p className="stat-card-value">{manualSortableCount}</p>
              <p className="stat-card-label">Manual sort eligible</p>
            </div>
          </div>
        ) : null}
      </s-stack>

      <s-section padding="none">
        {collections.length === 0 ? (
          <s-box padding="base" background="subdued">
            <s-paragraph>No collections synced yet.</s-paragraph>
          </s-box>
        ) : (
          <div className={styles.tableShell}>
          <s-table loading={tableLoading}>
            <s-box slot="filters" padding="small">
              <s-stack direction="block" gap="small-200">
                <s-grid
                  gap="small-200"
                  gridTemplateColumns="1fr auto"
                  alignItems="center"
                >
                  <s-stack direction="inline" gap="small-100">
                    <s-clickable-chip
                      color={tab === "all" ? "strong" : "base"}
                      onClick={() => setTab("all")}
                    >
                      All ({counts.all})
                    </s-clickable-chip>
                    <s-clickable-chip
                      color={tab === "enabled" ? "strong" : "base"}
                      onClick={() => setTab("enabled")}
                    >
                      Push down enabled ({counts.enabled})
                    </s-clickable-chip>
                  </s-stack>
                  <s-stack direction="inline" gap="small-100" alignItems="center">
                    <s-button-group
                      gap="none"
                      accessibilityLabel="Search and filter collections"
                    >
                      <s-button
                        slot="secondary-actions"
                        variant="secondary"
                        icon="search"
                        accessibilityLabel="Search collections"
                        onClick={() => setSearchOpen((open) => !open)}
                      />
                      <s-button
                        slot="secondary-actions"
                        variant="secondary"
                        icon="filter"
                        accessibilityLabel="Filter collections"
                        onClick={() =>
                          setTab((current) =>
                            current === "enabled" ? "all" : "enabled",
                          )
                        }
                      />
                    </s-button-group>
                    <s-button
                      variant="secondary"
                      icon={
                        titleSort === "asc"
                          ? "sort-ascending"
                          : titleSort === "desc"
                            ? "sort-descending"
                            : "sort"
                      }
                      accessibilityLabel={sortAccessibilityLabel}
                      onClick={handleSortToggle}
                    />
                  </s-stack>
                </s-grid>
                {searchOpen ? (
                  <div className={styles.searchPanel}>
                    <s-search-field
                      id="collections-search-field"
                      label="Search collections"
                      labelAccessibilityVisibility="exclusive"
                      placeholder="Search collections"
                      value={search}
                      onInput={(event) =>
                        handleSearchInput(event.currentTarget.value)
                      }
                      onChange={(event) =>
                        handleSearchInput(event.currentTarget.value)
                      }
                    />
                  </div>
                ) : null}
              </s-stack>
            </s-box>
            <s-table-header-row>
              <s-table-header listSlot="primary">Collection</s-table-header>
              <s-table-header listSlot="labeled">
                Applied sorting rule
              </s-table-header>
              <s-table-header listSlot="inline">Push down status</s-table-header>
              <s-table-header listSlot="labeled">Last sorted at</s-table-header>
              <s-table-header listSlot="labeled" />
            </s-table-header-row>
            <s-table-body>
              {filteredCollections.length === 0 ? (
                <s-table-row>
                  <s-table-cell>
                    <s-text color="subdued">
                      No collections match your search or filter.
                    </s-text>
                  </s-table-cell>
                  <s-table-cell />
                  <s-table-cell />
                  <s-table-cell />
                  <s-table-cell />
                </s-table-row>
              ) : (
                filteredCollections.map((collection) => (
                  <CollectionTableRow
                    key={collection.id}
                    collection={collection}
                    onToggle={handleToggle}
                    onRetry={handleRetry}
                    onPreview={handlePreview}
                    isToggling={togglingId === collection.id}
                    isRetrying={retryingId === collection.id}
                    optimisticInProgress={optimisticSortingIds.has(
                      collection.id,
                    )}
                  />
                ))
              )}
            </s-table-body>
          </s-table>
          </div>
        )}
      </s-section>

      <CollectionPreviewModal
        collection={previewModalCollection}
        isLoading={
          previewCollectionId != null &&
          (previewFetcher.state !== "idle" ||
            previewFetcher.data?.collection?.id !== previewCollectionId)
        }
        error={previewError}
        onClose={handleClosePreview}
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
