import type { Job, JobStatus, JobType } from "@prisma/client";

import prisma from "../db.server";
import { toCollectionGid } from "../services/shopify-collections.server";
import { toProductGid } from "../services/shopify-product-inventory.server";
import { enqueueJob } from "./job.server";
import { ensureShop } from "./shop.server";

const SORT_JOB_TYPES: JobType[] = [
  "BACKFILL_SOLD_OUT_PRODUCTS",
  "REORDER_SOLD_OUT_PRODUCT",
];

const ACTIVE_JOB_STATUSES: JobStatus[] = ["PENDING", "PROCESSING"];

// DEAD jobs before this point are ignored for per-collection failure UI.
const SORT_STATUS_TRACKING_EPOCH = new Date("2026-06-11T10:00:17.000Z");

export type CollectionSortStatusState =
  | "never"
  | "in_progress"
  | "failed"
  | "completed";

export type CollectionSortStatus = {
  state: CollectionSortStatusState;
  lastSortedAt: string | null;
  failedAt: string | null;
};

type CollectionSortInput = {
  id: string;
  shopifyCollectionId: string;
  enabled: boolean;
  lastSortedAt: Date | null;
  enabledAt: Date | null;
  lastSortAttemptAt: Date | null;
};

function readShopifyCollectionId(payload: Job["payload"]): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const value = (payload as { shopifyCollectionId?: unknown }).shopifyCollectionId;
  return typeof value === "string" ? toCollectionGid(value) : null;
}

function isTrackableFailureJob(jobUpdatedAt: Date): boolean {
  return jobUpdatedAt.getTime() >= SORT_STATUS_TRACKING_EPOCH.getTime();
}

function isCurrentSortFailure(
  deadAt: Date,
  collection: CollectionSortInput,
): boolean {
  if (!collection.enabled) {
    return false;
  }

  if (!isTrackableFailureJob(deadAt)) {
    return false;
  }

  if (collection.enabledAt && deadAt < collection.enabledAt) {
    return false;
  }

  if (collection.lastSortedAt && deadAt <= collection.lastSortedAt) {
    return false;
  }

  if (!collection.lastSortAttemptAt) {
    return false;
  }

  return deadAt >= collection.lastSortAttemptAt;
}

function buildCompletedStatus(lastSortedAt: Date): CollectionSortStatus {
  const iso = lastSortedAt.toISOString();
  return {
    state: "completed",
    lastSortedAt: iso,
    failedAt: null,
  };
}

function buildNeverStatus(): CollectionSortStatus {
  return {
    state: "never",
    lastSortedAt: null,
    failedAt: null,
  };
}

export async function touchCollectionLastSortedAt(
  collectionId: string,
  sortedAt: Date = new Date(),
): Promise<void> {
  await prisma.collection.update({
    where: { id: collectionId },
    data: { lastSortedAt: sortedAt },
  });
}

export async function markCollectionSortAttemptStarted(
  collectionId: string,
  startedAt: Date = new Date(),
): Promise<void> {
  await prisma.collection.update({
    where: { id: collectionId },
    data: { lastSortAttemptAt: startedAt },
  });
}

export async function getCollectionSortStatusMap(
  shopDomain: string,
  collections: CollectionSortInput[],
): Promise<Map<string, CollectionSortStatus>> {
  const [activeJobs, deadReorderJobs] = await Promise.all([
    prisma.job.findMany({
      where: {
        shopDomain,
        type: { in: SORT_JOB_TYPES },
        status: { in: ACTIVE_JOB_STATUSES },
      },
      select: {
        type: true,
        payload: true,
      },
    }),
    prisma.job.findMany({
      where: {
        shopDomain,
        type: "REORDER_SOLD_OUT_PRODUCT",
        status: "DEAD",
        updatedAt: { gte: SORT_STATUS_TRACKING_EPOCH },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        payload: true,
        updatedAt: true,
      },
    }),
  ]);

  const activeBackfill = activeJobs.some(
    (job) => job.type === "BACKFILL_SOLD_OUT_PRODUCTS",
  );

  const activeReorderCollectionIds = new Set(
    activeJobs
      .filter((job) => job.type === "REORDER_SOLD_OUT_PRODUCT")
      .map((job) => readShopifyCollectionId(job.payload))
      .filter((value): value is string => Boolean(value)),
  );

  const latestDeadReorderByCollection = new Map<string, Date>();
  for (const job of deadReorderJobs) {
    const collectionGid = readShopifyCollectionId(job.payload);
    if (!collectionGid || latestDeadReorderByCollection.has(collectionGid)) {
      continue;
    }

    latestDeadReorderByCollection.set(collectionGid, job.updatedAt);
  }

  const statusMap = new Map<string, CollectionSortStatus>();

  for (const collection of collections) {
    const collectionGid = toCollectionGid(collection.shopifyCollectionId);

    const isActive =
      collection.enabled &&
      (activeReorderCollectionIds.has(collectionGid) || activeBackfill);

    if (isActive) {
      statusMap.set(collection.id, {
        state: "in_progress",
        lastSortedAt: collection.lastSortedAt?.toISOString() ?? null,
        failedAt: null,
      });
      continue;
    }

    const deadReorderAt = latestDeadReorderByCollection.get(collectionGid) ?? null;
    const failureAt =
      deadReorderAt && isCurrentSortFailure(deadReorderAt, collection)
        ? deadReorderAt
        : null;

    if (collection.lastSortedAt) {
      if (failureAt) {
        statusMap.set(collection.id, {
          state: "failed",
          lastSortedAt: collection.lastSortedAt.toISOString(),
          failedAt: failureAt.toISOString(),
        });
      } else {
        statusMap.set(collection.id, buildCompletedStatus(collection.lastSortedAt));
      }
      continue;
    }

    if (failureAt) {
      statusMap.set(collection.id, {
        state: "failed",
        lastSortedAt: null,
        failedAt: failureAt.toISOString(),
      });
      continue;
    }

    statusMap.set(collection.id, buildNeverStatus());
  }

  return statusMap;
}

export async function shopHasActiveCollectionSortJobs(
  shopDomain: string,
): Promise<boolean> {
  const count = await prisma.job.count({
    where: {
      shopDomain,
      type: { in: SORT_JOB_TYPES },
      status: { in: ACTIVE_JOB_STATUSES },
    },
  });

  return count > 0;
}

export async function enqueueCollectionSortRetry(
  shopDomain: string,
  collectionId: string,
): Promise<boolean> {
  const shop = await ensureShop(shopDomain);

  const collection = await prisma.collection.findFirst({
    where: {
      id: collectionId,
      shopId: shop.id,
      enabled: true,
    },
    select: {
      id: true,
      shopifyCollectionId: true,
    },
  });

  if (!collection) {
    return false;
  }

  const positions = await prisma.collectionProductPosition.findMany({
    where: {
      collectionId: collection.id,
      trackedProduct: {
        isSoldOut: true,
      },
    },
    include: {
      trackedProduct: {
        select: { shopifyProductId: true },
      },
    },
  });

  if (positions.length === 0) {
    return false;
  }

  await markCollectionSortAttemptStarted(collection.id);

  for (const position of positions) {
    const productGid = toProductGid(position.trackedProduct.shopifyProductId);

    await enqueueJob({
      shopDomain,
      type: "REORDER_SOLD_OUT_PRODUCT",
      payload: {
        shopifyCollectionId: collection.shopifyCollectionId,
        shopifyProductId: productGid,
      },
      dedupeKey: `${shopDomain}:reorder-sold-out:${collection.shopifyCollectionId}:${productGid}`,
      priority: 5,
      runAt: new Date(),
    });
  }

  return true;
}
