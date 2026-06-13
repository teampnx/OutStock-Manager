import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { CollectionPinningPanel } from "../components/CollectionPinningPanel";
import { pageTitle } from "../lib/branding";
import { getCollectionDetails } from "../models/collection-management.server";
import {
  getPinningPlanContext,
  handlePinningFormAction,
  listPinnedProductsForCollection,
} from "../models/pinned-product.server";
import { authenticate } from "../shopify.server";
import styles from "../styles/collections.module.css";

export function meta({ data }: { data?: { collectionTitle?: string } }) {
  const title = data?.collectionTitle
    ? pageTitle(`Pinning · ${data.collectionTitle}`)
    : pageTitle("Manage pinning");
  return [{ title }];
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
      collectionTitle: collection.title,
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
      collectionTitle: undefined,
      error: "Could not load collection pinning. Please refresh the page.",
    };
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const collectionId = params.id;
  const formData = await request.formData();

  if (!collectionId) {
    return { success: false as const, error: "Missing collection id." };
  }

  return handlePinningFormAction(session.shop, collectionId, formData, admin);
};

export default function PinningCollectionPage() {
  const { collection, pinnedProducts, pinning, error } =
    useLoaderData<typeof loader>();

  if (error || !collection) {
    return (
      <s-page heading="Manage pinning" inlineSize="large">
        <s-link slot="primary-action" href="/app/pinning">
          Back to pinning
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

  return (
    <s-page heading={`Pinning · ${collection.title}`} inlineSize="large">
      <s-link slot="primary-action" href="/app/pinning">
        Back to pinning
      </s-link>
      <s-link slot="secondary-actions" href={`/app/collections/${collection.id}`}>
        Collection details
      </s-link>

      <s-section heading="Collection">
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
      </s-section>

      <s-section heading="Pinned products">
        <CollectionPinningPanel
          pinnedProducts={pinnedProducts}
          pinning={pinning}
          pinCandidates={pinCandidates}
          sortOrderLabel={collection.sortOrderLabel}
          isManualCollection={isManualCollection}
        />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
