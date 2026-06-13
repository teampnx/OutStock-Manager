import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { CollectionPinningPanel } from "../components/CollectionPinningPanel";
import { formatDateTime, formatStoreDateTime } from "../lib/format-datetime";
import { pageTitle } from "../lib/branding";
import {
  getCollectionDetails,
  SetCollectionEnabledError,
  setCollectionEnabled,
} from "../models/collection-management.server";
import {
  getPinningPlanContext,
  handlePinningFormAction,
  listPinnedProductsForCollection,
} from "../models/pinned-product.server";
import { authenticate } from "../shopify.server";
import styles from "../styles/collections.module.css";

export function meta() {
  return [{ title: pageTitle("Collection details") }];
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const collectionId = params.id;

  if (!collectionId) {
    throw new Response("Collection not found", { status: 404 });
  }

  try {
    const [collection, pinnedProducts, pinning] = await Promise.all([
      getCollectionDetails(session.shop, collectionId, admin),
      listPinnedProductsForCollection(session.shop, collectionId),
      getPinningPlanContext(session.shop, collectionId),
    ]);

    if (!collection) {
      throw new Response("Collection not found", { status: 404 });
    }

    return {
      collection,
      pinnedProducts,
      pinning,
      error: null,
    };
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    return {
      collection: null,
      pinnedProducts: [],
      pinning: null,
      error: "Could not load collection details. Please refresh the page.",
    };
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const collectionId = params.id;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (!collectionId) {
    return { success: false as const, error: "Missing collection id." };
  }

  if (intent === "toggle-enabled") {
    const enabled = formData.get("enabled") === "true";
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
        `[collection-details] Failed to toggle enabled for ${collectionId}:`,
        error,
      );
      return {
        success: false as const,
        error:
          error instanceof SetCollectionEnabledError
            ? error.message
            : "Could not update collection status.",
      };
    }
  }

  if (intent === "pin-product" || intent === "unpin-product" || intent === "move-pin-up" || intent === "move-pin-down") {
    return handlePinningFormAction(session.shop, collectionId, formData, admin);
  }

  return { success: false as const, error: "Unknown action." };
};

function formatLastReorder(
  activity: NonNullable<
    Awaited<ReturnType<typeof getCollectionDetails>>
  >["lastReorderActivity"],
) {
  if (!activity) {
    return "—";
  }

  const positionText =
    activity.oldPosition != null && activity.newPosition != null
      ? ` · position ${activity.oldPosition} → ${activity.newPosition}`
      : "";

  const productText = activity.productTitle ? ` · ${activity.productTitle}` : "";

  return `${activity.label}${productText}${positionText} · ${formatDateTime(activity.occurredAt)}`;
}

export default function CollectionDetailsPage() {
  const { collection, pinnedProducts, pinning, error } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const isBusy = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data?.success) {
      return;
    }

    if (fetcher.data.intent === "toggle-enabled") {
      if ("sortBlockedReason" in fetcher.data && fetcher.data.sortBlockedReason) {
        shopify.toast.show(fetcher.data.sortBlockedReason, { isError: true });
      } else {
        shopify.toast.show("Collection status updated");
      }
    }
  }, [fetcher.data, shopify]);

  if (error || !collection) {
    return (
      <s-page heading="Collection details" inlineSize="large">
        <s-link slot="primary-action" href="/app/collections">
          Back to collections
        </s-link>
        <s-banner tone="critical" heading="Unable to load collection">
          <s-paragraph>{error ?? "Collection not found."}</s-paragraph>
        </s-banner>
      </s-page>
    );
  }

  const pinnedIds = new Set(pinnedProducts.map((pin) => pin.shopifyProductId));
  const pinCandidates = collection.products.filter(
    (product) => !pinnedIds.has(product.productId),
  );
  const isManualCollection = collection.sortOrder === "MANUAL";

  const toggleError =
    fetcher.data?.success === false &&
    fetcher.formData?.get("intent") === "toggle-enabled"
      ? fetcher.data.error
      : null;

  return (
    <s-page heading={collection.title} inlineSize="large">
      <s-link slot="primary-action" href="/app/collections">
        Back to collections
      </s-link>

      {collection.sortBlockedReason ? (
        <s-banner tone="warning" heading="Sorting unavailable">
          <s-paragraph>{collection.sortBlockedReason}</s-paragraph>
        </s-banner>
      ) : null}

      {toggleError ? (
        <s-banner tone="critical" heading="Action failed">
          <s-paragraph>{toggleError}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading="Collection overview">
        <div className={styles.collectionCell}>
          {collection.imageUrl ? (
            <img
              src={collection.imageUrl}
              alt={collection.imageAlt ?? collection.title}
              className={styles.collectionImage}
              width={56}
              height={56}
            />
          ) : (
            <div className={styles.collectionPlaceholder}>No image</div>
          )}
          <div>
            <s-paragraph>
              <s-text type="strong">{collection.title}</s-text>
            </s-paragraph>
            <p className={styles.muted}>
              {collection.productCount} products · {collection.sortOrderLabel}
            </p>
          </div>
        </div>

        <div className={styles.detailGrid}>
          <div className={styles.detailCard}>
            <div className={styles.detailLabel}>Push down status</div>
            <div className={styles.detailValue}>
              <span
                className={
                  collection.enabled ? styles.badgeEnabled : styles.badgeDisabled
                }
              >
                <span className={styles.badgeDot} />
                {collection.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
          </div>
          <div className={styles.detailCard}>
            <div className={styles.detailLabel}>Sold-out products</div>
            <div className={styles.detailValue}>{collection.soldOutCount}</div>
          </div>
          <div className={styles.detailCard}>
            <div className={styles.detailLabel}>Last sync</div>
            <div className={styles.detailValue}>
              {formatDateTime(collection.lastSyncedAt)}
            </div>
          </div>
          <div className={styles.detailCard}>
            <div className={styles.detailLabel}>Last sorted at</div>
            <div className={styles.detailValue}>
              {collection.sortStatus.state === "in_progress" ? (
                <div className={styles.sortStatusCell}>
                  <s-spinner
                    accessibilityLabel="Sorting in progress"
                    size="base"
                  />
                  Sorting in progress
                </div>
              ) : collection.sortStatus.state === "failed" ? (
                <span className={styles.badgeFailed}>
                  <span className={styles.badgeDot} />
                  Sorting failed
                </span>
              ) : collection.sortStatus.lastSortedAt ? (
                formatStoreDateTime(collection.sortStatus.lastSortedAt)
              ) : (
                "Never"
              )}
            </div>
          </div>
        </div>

        <s-stack direction="inline" gap="base">
          <s-button
            onClick={() =>
              fetcher.submit(
                {
                  intent: "toggle-enabled",
                  enabled: String(!collection.enabled),
                },
                { method: "post" },
              )
            }
            {...(isBusy ? { loading: true } : {})}
            disabled={isBusy}
          >
            {collection.enabled ? "Disable collection" : "Enable collection"}
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Pinned products">
        <s-stack direction="block" gap="small-100">
          <s-link href={`/app/pinning/${collection.id}`}>
            Manage on Pinning page
          </s-link>
          <CollectionPinningPanel
            pinnedProducts={pinnedProducts}
            pinning={pinning}
            pinCandidates={pinCandidates}
            sortOrderLabel={collection.sortOrderLabel}
            isManualCollection={isManualCollection}
          />
        </s-stack>
      </s-section>

      <s-section heading="Last reorder activity">
        <s-paragraph>{formatLastReorder(collection.lastReorderActivity)}</s-paragraph>
      </s-section>

      <s-section heading="Current order" padding="none">
        {collection.products.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>No products in this collection.</s-paragraph>
          </s-box>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Original position</th>
                  <th>Current position</th>
                </tr>
              </thead>
              <tbody>
                {collection.products.map((product) => (
                  <tr
                    key={product.productId}
                    className={product.isSoldOut ? styles.soldOutRow : undefined}
                  >
                    <td>{product.position}</td>
                    <td>
                      {product.title}
                      {pinnedIds.has(product.productId) ? (
                        <span className={styles.pinnedTag}>Pinned</span>
                      ) : null}
                    </td>
                    <td>{product.inventoryStatus}</td>
                    <td>{product.originalPosition ?? "—"}</td>
                    <td>{product.currentPosition ?? product.position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      <s-section heading="Sold-out products">
        {collection.soldOutCount === 0 ? (
          <s-paragraph>No sold-out products in this collection.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="small">
            {collection.products
              .filter((product) => product.isSoldOut)
              .map((product) => (
                <s-paragraph key={product.productId}>
                  {product.title} · position {product.position}
                </s-paragraph>
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
