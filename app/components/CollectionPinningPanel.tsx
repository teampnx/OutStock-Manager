import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import type { CollectionProductRow } from "../models/collection-management.server";
import type {
  PinnedProductItem,
  PinningPlanContext,
} from "../models/pinned-product.server";
import styles from "../styles/collections.module.css";

type PinningFetcherData = {
  success: boolean;
  intent?: string;
  error?: string;
};

type CollectionPinningPanelProps = {
  pinnedProducts: PinnedProductItem[];
  pinning: PinningPlanContext | null;
  pinCandidates: CollectionProductRow[];
  sortOrderLabel: string;
  isManualCollection: boolean;
};

export function CollectionPinningPanel({
  pinnedProducts,
  pinning,
  pinCandidates,
  sortOrderLabel,
  isManualCollection,
}: CollectionPinningPanelProps) {
  const fetcher = useFetcher<PinningFetcherData>();
  const shopify = useAppBridge();
  const [pinProductId, setPinProductId] = useState("");
  const isBusy = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data?.success) {
      return;
    }

    if (fetcher.data.intent === "pin-product") {
      shopify.toast.show("Product pinned");
      setPinProductId("");
    } else if (fetcher.data.intent === "unpin-product") {
      shopify.toast.show("Pin removed");
    } else if (fetcher.data.intent === "reorder-pinned") {
      shopify.toast.show("Pin order updated");
    }
  }, [fetcher.data, shopify]);

  const pinActionError =
    fetcher.data?.success === false && fetcher.data.intent
      ? fetcher.data.error
      : fetcher.data?.success === false && !fetcher.formData?.get("intent")
        ? null
        : fetcher.data?.success === false
          ? fetcher.data.error
          : null;

  return (
    <s-stack direction="block" gap="base">
      <p className={styles.muted}>
        Pinned products stay at the top of this collection. In-stock products
        follow pins; sold-out products stay at the bottom.
      </p>

      {pinning && !pinning.pinningAvailable ? (
        <div className="curatify-banner">
          <p className="curatify-banner-title">Upgrade to pin products</p>
          <p className="curatify-banner-text">
            Product pinning is available on Growth (5 pins per collection) and
            Pro (unlimited).{" "}
            <s-link href="/app/pricing">View pricing</s-link>
          </p>
        </div>
      ) : null}

      {pinning?.pinningAvailable && pinning.plan === "GROWTH" ? (
        <div className="curatify-banner">
          <p className="curatify-banner-title">Growth plan pinning</p>
          <p className="curatify-banner-text">
            Pin up to 5 products per manual collection. Need more?{" "}
            <s-link href="/app/pricing">Upgrade to Pro</s-link> for unlimited
            pins.
          </p>
        </div>
      ) : null}

      {!isManualCollection ? (
        <s-banner tone="warning" heading="Manual collection required">
          <s-paragraph>
            Product pinning only works on manual collections. This collection
            uses {sortOrderLabel}.
          </s-paragraph>
        </s-banner>
      ) : null}

      {pinning?.pinningAvailable && pinning.atLimit ? (
        <s-banner tone="warning" heading="Pin limit reached">
          <s-paragraph>
            Your {pinning.plan === "GROWTH" ? "Growth" : "current"} plan allows{" "}
            {pinning.limit} pinned products per collection. Remove a pin or{" "}
            <s-link href="/app/pricing">upgrade your plan</s-link>.
          </s-paragraph>
        </s-banner>
      ) : null}

      {pinning?.pinningAvailable ? (
        <p className={styles.pinLimitText}>
          {pinning.limit == null
            ? `${pinning.currentCount} pinned · Unlimited on Pro`
            : `${pinning.currentCount} of ${pinning.limit} pins used`}
        </p>
      ) : null}

      {pinActionError ? (
        <s-banner tone="critical">
          <s-paragraph>{pinActionError}</s-paragraph>
        </s-banner>
      ) : null}

      {pinnedProducts.length === 0 ? (
        <div className="curatify-empty curatify-empty--compact">
          <p className="curatify-empty-title">No pinned products</p>
          <p className="curatify-empty-text">
            Select a product below to pin it to the top of this collection.
          </p>
        </div>
      ) : (
        <div className={styles.pinnedList}>
          {pinnedProducts.map((pin, index) => (
            <div key={pin.id} className={styles.pinnedRow}>
              <span className={styles.pinnedPosition}>{index + 1}</span>
              <div className={styles.pinnedMain}>
                <s-text type="strong">{pin.title}</s-text>
                {pin.isSoldOut ? (
                  <s-badge tone="warning">Sold out</s-badge>
                ) : null}
              </div>
              <s-stack direction="inline" gap="small-100">
                <s-button
                  variant="tertiary"
                  icon="arrow-up"
                  accessibilityLabel={`Move ${pin.title} up`}
                  disabled={index === 0 || isBusy || !isManualCollection}
                  onClick={() =>
                    fetcher.submit(
                      {
                        intent: "move-pin-up",
                        pinnedProductId: pin.id,
                      },
                      { method: "post" },
                    )
                  }
                />
                <s-button
                  variant="tertiary"
                  icon="arrow-down"
                  accessibilityLabel={`Move ${pin.title} down`}
                  disabled={
                    index === pinnedProducts.length - 1 ||
                    isBusy ||
                    !isManualCollection
                  }
                  onClick={() =>
                    fetcher.submit(
                      {
                        intent: "move-pin-down",
                        pinnedProductId: pin.id,
                      },
                      { method: "post" },
                    )
                  }
                />
                <s-button
                  variant="tertiary"
                  tone="critical"
                  icon="delete"
                  accessibilityLabel={`Remove pin for ${pin.title}`}
                  disabled={isBusy || !isManualCollection}
                  onClick={() =>
                    fetcher.submit(
                      {
                        intent: "unpin-product",
                        pinnedProductId: pin.id,
                      },
                      { method: "post" },
                    )
                  }
                />
              </s-stack>
            </div>
          ))}
        </div>
      )}

      {pinning?.pinningAvailable &&
      !pinning.atLimit &&
      isManualCollection ? (
        <s-stack direction="inline" gap="small-100" alignItems="end">
          <div className={styles.pinSelectWrap}>
            <s-select
              label="Product to pin"
              value={pinProductId}
              disabled={isBusy || pinCandidates.length === 0}
              onChange={(event) => setPinProductId(event.currentTarget.value)}
            >
              <s-option value="">Select a product</s-option>
              {pinCandidates.map((product) => (
                <s-option key={product.productId} value={product.productId}>
                  {product.title}
                </s-option>
              ))}
            </s-select>
          </div>
          <s-button
            icon="pin"
            disabled={!pinProductId || isBusy}
            onClick={() =>
              fetcher.submit(
                { intent: "pin-product", productId: pinProductId },
                { method: "post" },
              )
            }
            {...(fetcher.formData?.get("intent") === "pin-product" && isBusy
              ? { loading: true }
              : {})}
          >
            Pin product
          </s-button>
        </s-stack>
      ) : null}
    </s-stack>
  );
}
