import { useMemo, type ReactNode } from "react";

import type { CollectionProductRow } from "../models/collection-management.server";
import { buildSortedPreview } from "../lib/collection-sort-preview";
import "../styles/collection-preview.css";
import styles from "../styles/collections.module.css";

type ModalElement = HTMLElement & {
  showOverlay: () => void;
  hideOverlay: () => void;
};

type PreviewCollection = {
  title: string;
  productCount: number;
  products: CollectionProductRow[];
};

const panelStyle = {
  width: "100%",
  overflow: "hidden",
  border: "1px solid var(--c-border, #ddd8f0)",
  borderRadius: "12px",
  background: "var(--c-surface, #fff)",
  boxSizing: "border-box",
} as const;

const panelHeaderStyle = {
  padding: "10px 14px",
  fontSize: "13px",
  fontWeight: 600,
  lineHeight: "1.4",
  color: "var(--c-ink, #1a1625)",
  background: "var(--c-surface-tinted, #f0eef9)",
  borderBottom: "1px solid var(--c-border, #ddd8f0)",
} as const;

const panelBodyStyle = {
  width: "100%",
  background: "var(--c-surface, #fff)",
} as const;

const previewRowStyle = {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: "12px",
  width: "100%",
  minHeight: "44px",
  padding: "6px 14px",
  boxSizing: "border-box",
} as const;

const previewIndexStyle = {
  flexShrink: 0,
  width: "24px",
  fontSize: "13px",
  lineHeight: "20px",
  color: "var(--c-muted, #6e6a88)",
} as const;

const previewThumbStyle = {
  flexShrink: 0,
  width: "36px",
  height: "36px",
  borderRadius: "8px",
  objectFit: "cover",
  background: "var(--c-purple-light, #eae7fb)",
  border: "1px solid var(--c-border, #ddd8f0)",
} as const;

const previewTitleStyle = {
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "13px",
  lineHeight: "20px",
  color: "var(--c-ink, #1a1625)",
} as const;

function PreviewProductThumbnail({
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
      <img
        className={`collection-preview-product-thumb ${styles.previewProductImage}`}
        src={imageUrl}
        alt={imageAlt ?? title}
        style={previewThumbStyle}
        width={36}
        height={36}
        loading="lazy"
      />
    );
  }

  return (
    <div
      className={`collection-preview-product-thumb-placeholder ${styles.previewProductImagePlaceholder}`}
      style={previewThumbStyle}
      aria-hidden="true"
    />
  );
}

function PreviewProductRow({
  index,
  title,
  imageUrl,
  imageAlt,
}: {
  index: number;
  title: string;
  imageUrl: string | null;
  imageAlt: string | null;
}) {
  return (
    <div
      className={`collection-preview-product-row ${styles.previewProductRow}`}
      style={previewRowStyle}
    >
      <span
        className={`collection-preview-product-index ${styles.previewProductIndex}`}
        style={previewIndexStyle}
      >
        {index}.
      </span>
      <PreviewProductThumbnail
        title={title}
        imageUrl={imageUrl}
        imageAlt={imageAlt}
      />
      <span
        className={`collection-preview-product-title ${styles.previewProductTitle}`}
        style={previewTitleStyle}
      >
        {title}
      </span>
    </div>
  );
}

function PreviewSectionPanel({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`collection-preview-panel ${styles.previewSectionPanel}`}
      style={panelStyle}
    >
      <div
        className={`collection-preview-panel-header ${styles.previewSectionPanelHeader}`}
        style={panelHeaderStyle}
      >
        {heading}
      </div>
      <div
        className={`collection-preview-panel-body ${styles.previewSectionPanelBody}`}
        style={panelBodyStyle}
      >
        {children}
      </div>
    </section>
  );
}

export function CollectionPreviewModal({
  collection,
  isLoading,
  error,
  onClose,
}: {
  collection: PreviewCollection | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const preview = useMemo(() => {
    if (!collection) {
      return null;
    }

    return buildSortedPreview(
      collection.products.map((product) => ({
        productId: product.productId,
        title: product.title,
        imageUrl: product.imageUrl,
        imageAlt: product.imageAlt,
        isSoldOut: product.isSoldOut,
      })),
    );
  }, [collection]);

  const handleClose = () => {
    (
      document.getElementById("collection-preview-modal") as ModalElement | null
    )?.hideOverlay();
    onClose();
  };

  const topCount = preview?.topProducts.length ?? 0;
  const pushedCount = preview?.pushedDownProducts.length ?? 0;

  return (
    <s-modal
      id="collection-preview-modal"
      heading="Preview sorted products"
      size="large"
      padding="base"
      onHide={onClose}
    >
      {isLoading ? (
        <div className={styles.previewLoading}>
          <s-spinner accessibilityLabel="Loading preview" size="base" />
        </div>
      ) : error ? (
        <s-banner tone="critical" heading="Unable to load preview">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      ) : collection && preview ? (
        <div
          className={`collection-preview-content ${styles.previewModalContent}`}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            width: "100%",
          }}
        >
          <header
            className={`collection-preview-header ${styles.previewHeader}`}
            style={{ display: "flex", flexDirection: "column", gap: "2px" }}
          >
            <p
              className={`collection-preview-collection-name ${styles.previewCollectionName}`}
              style={{ margin: 0, fontSize: "14px", lineHeight: "1.4" }}
            >
              <span
                className={`collection-preview-collection-label ${styles.previewCollectionLabel}`}
                style={{ fontWeight: 600 }}
              >
                Collection:
              </span>{" "}
              {collection.title}
            </p>
            <p
              className={`collection-preview-description ${styles.previewDescription}`}
              style={{
                margin: 0,
                fontSize: "13px",
                lineHeight: "1.4",
                color: "var(--c-muted, #6e6a88)",
              }}
            >
              Showing preview of products sorted as per configured settings
            </p>
            <p
              className={`collection-preview-meta ${styles.previewMeta}`}
              style={{
                margin: "4px 0 0",
                fontSize: "12px",
                lineHeight: "1.4",
                color: "var(--c-muted, #6e6a88)",
              }}
            >
              {collection.productCount}{" "}
              {collection.productCount === 1 ? "product" : "products"} ·{" "}
              {topCount} will remain at the top · {pushedCount} will be pushed
              down
            </p>
          </header>

          <PreviewSectionPanel heading="1. Top products">
            {topCount === 0 ? (
              <div
                className={`collection-preview-panel-empty ${styles.previewPanelEmpty}`}
                style={{ padding: "24px 14px", textAlign: "center" }}
              >
                No products in this collection.
              </div>
            ) : (
              <div
                className={`collection-preview-product-list ${styles.previewProductList}`}
              >
                {preview.topProducts.map((product, index) => (
                  <PreviewProductRow
                    key={product.productId}
                    index={index + 1}
                    title={product.title}
                    imageUrl={product.imageUrl}
                    imageAlt={product.imageAlt}
                  />
                ))}
              </div>
            )}
          </PreviewSectionPanel>

          <PreviewSectionPanel heading="2. Pushed down products">
            {pushedCount === 0 ? (
              <div
                className={`collection-preview-panel-empty ${styles.previewPanelEmpty}`}
                style={{ padding: "24px 14px", textAlign: "center" }}
              >
                <p
                  className={`collection-preview-panel-empty-lead ${styles.previewEmptyStateLead}`}
                >
                  ✓ No sold-out products found.
                </p>
                <p>No products will be moved to the bottom.</p>
              </div>
            ) : (
              <div
                className={`collection-preview-product-list ${styles.previewProductList}`}
              >
                {preview.pushedDownProducts.map((product, index) => (
                  <PreviewProductRow
                    key={product.productId}
                    index={index + 1}
                    title={product.title}
                    imageUrl={product.imageUrl}
                    imageAlt={product.imageAlt}
                  />
                ))}
              </div>
            )}
          </PreviewSectionPanel>
        </div>
      ) : null}

      <s-button
        slot="secondary-actions"
        variant="secondary"
        onClick={handleClose}
      >
        Close
      </s-button>
    </s-modal>
  );
}

export function showCollectionPreviewModal() {
  (
    document.getElementById("collection-preview-modal") as ModalElement | null
  )?.showOverlay();
}
