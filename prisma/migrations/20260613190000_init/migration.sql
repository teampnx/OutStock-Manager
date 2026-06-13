-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'GROWTH', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'CANCELLED', 'DECLINED', 'EXPIRED', 'FROZEN');

-- CreateEnum
CREATE TYPE "RestorePosition" AS ENUM ('ORIGINAL', 'TOP');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InventoryPolicy" AS ENUM ('DENY', 'CONTINUE');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('IN_STOCK', 'SOLD_OUT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TriggerSource" AS ENUM ('WEBHOOK_INVENTORY', 'WEBHOOK_PRODUCT', 'BACKFILL', 'MANUAL');

-- CreateEnum
CREATE TYPE "CollectionSortOrder" AS ENUM ('MANUAL', 'ALPHA_ASC', 'ALPHA_DESC', 'BEST_SELLING', 'CREATED', 'CREATED_DESC', 'PRICE_ASC', 'PRICE_DESC');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('PROCESS_INVENTORY_CHANGE', 'PROCESS_PRODUCT_UPDATE', 'CLEANUP_SHOP', 'REORDER_COLLECTION_CHUNK', 'REORDER_SOLD_OUT_PRODUCT', 'RESTORE_PRODUCT_POSITION', 'SYNC_PRODUCT_COLLECTIONS', 'SYNC_COLLECTION', 'SYNC_COLLECTION_MEMBERSHIP', 'BACKFILL_COLLECTIONS', 'BACKFILL_SOLD_OUT_PRODUCTS', 'BACKFILL_SHOP');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('PUSH_SOLD_OUT', 'RESTORE_ORIGINAL', 'RESTORE_TOP', 'REORDER_SKIPPED', 'COLLECTION_SYNCED', 'COLLECTION_DELETED', 'BACKFILL_SOLD_OUT_COMPLETED', 'BACKFILL_COLLECTIONS_COMPLETED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopName" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "shopifySubscriptionId" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "isTest" BOOLEAN NOT NULL DEFAULT true,
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "pushSoldOutToBottom" BOOLEAN NOT NULL DEFAULT true,
    "restoreWhenBackInStock" BOOLEAN NOT NULL DEFAULT true,
    "restorePosition" "RestorePosition" NOT NULL DEFAULT 'ORIGINAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedProduct" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "tracksInventory" BOOLEAN NOT NULL DEFAULT false,
    "inventoryPolicy" "InventoryPolicy" NOT NULL DEFAULT 'DENY',
    "totalAvailable" INTEGER NOT NULL DEFAULT 0,
    "isSoldOut" BOOLEAN NOT NULL DEFAULT false,
    "soldOutAt" TIMESTAMP(3),
    "backInStockAt" TIMESTAMP(3),
    "lastStatusChangeAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyCollectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" "CollectionSortOrder" NOT NULL DEFAULT 'MANUAL',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "lastSortAttemptAt" TIMESTAMP(3),
    "lastSortedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "trackedProductId" TEXT,
    "collectionId" TEXT,
    "productTitle" TEXT,
    "collectionTitle" TEXT,
    "oldPosition" INTEGER,
    "newPosition" INTEGER,
    "detail" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PinnedProduct" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PinnedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionProductPosition" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "trackedProductId" TEXT NOT NULL,
    "originalPosition" INTEGER NOT NULL,
    "currentPosition" INTEGER NOT NULL,
    "restorePositionCaptured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionProductPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionMembership" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "trackedProductId" TEXT NOT NULL,
    "shopifyCollectionId" TEXT NOT NULL,
    "collectionTitle" TEXT,
    "sortOrder" "CollectionSortOrder" NOT NULL DEFAULT 'MANUAL',
    "isManualSort" BOOLEAN NOT NULL DEFAULT true,
    "currentPosition" INTEGER,
    "isAtBottom" BOOLEAN NOT NULL DEFAULT false,
    "removedFromCollection" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OriginalCollectionPosition" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "originalPosition" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),
    "restoreTarget" "RestorePosition",

    CONSTRAINT "OriginalCollectionPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryStatusHistory" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "trackedProductId" TEXT NOT NULL,
    "previousStatus" "InventoryStatus" NOT NULL,
    "newStatus" "InventoryStatus" NOT NULL,
    "totalAvailable" INTEGER NOT NULL DEFAULT 0,
    "triggerSource" "TriggerSource" NOT NULL,
    "shopifyWebhookId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shopifyWebhookId" TEXT NOT NULL,
    "shopId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 10,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_shopId_key" ON "Subscription"("shopId");

-- CreateIndex
CREATE INDEX "Subscription_shopifySubscriptionId_idx" ON "Subscription"("shopifySubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_shopId_key" ON "Settings"("shopId");

-- CreateIndex
CREATE INDEX "TrackedProduct_shopId_isSoldOut_idx" ON "TrackedProduct"("shopId", "isSoldOut");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedProduct_shopId_shopifyProductId_key" ON "TrackedProduct"("shopId", "shopifyProductId");

-- CreateIndex
CREATE INDEX "Collection_shopId_idx" ON "Collection"("shopId");

-- CreateIndex
CREATE INDEX "Collection_shopId_enabled_idx" ON "Collection"("shopId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_shopId_shopifyCollectionId_key" ON "Collection"("shopId", "shopifyCollectionId");

-- CreateIndex
CREATE INDEX "ActivityLog_shopId_createdAt_idx" ON "ActivityLog"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_shopId_type_idx" ON "ActivityLog"("shopId", "type");

-- CreateIndex
CREATE INDEX "PinnedProduct_shopId_idx" ON "PinnedProduct"("shopId");

-- CreateIndex
CREATE INDEX "PinnedProduct_collectionId_idx" ON "PinnedProduct"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "PinnedProduct_collectionId_shopifyProductId_key" ON "PinnedProduct"("collectionId", "shopifyProductId");

-- CreateIndex
CREATE UNIQUE INDEX "PinnedProduct_collectionId_position_key" ON "PinnedProduct"("collectionId", "position");

-- CreateIndex
CREATE INDEX "CollectionProductPosition_collectionId_idx" ON "CollectionProductPosition"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionProductPosition_collectionId_trackedProductId_key" ON "CollectionProductPosition"("collectionId", "trackedProductId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionMembership_shopId_shopifyCollectionId_trackedProd_key" ON "CollectionMembership"("shopId", "shopifyCollectionId", "trackedProductId");

-- CreateIndex
CREATE UNIQUE INDEX "OriginalCollectionPosition_membershipId_key" ON "OriginalCollectionPosition"("membershipId");

-- CreateIndex
CREATE INDEX "InventoryStatusHistory_shopId_trackedProductId_createdAt_idx" ON "InventoryStatusHistory"("shopId", "trackedProductId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_shopifyWebhookId_key" ON "WebhookEvent"("shopifyWebhookId");

-- CreateIndex
CREATE INDEX "WebhookEvent_shopDomain_receivedAt_idx" ON "WebhookEvent"("shopDomain", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_runAt_priority_idx" ON "Job"("status", "runAt", "priority");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedProduct" ADD CONSTRAINT "TrackedProduct_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_trackedProductId_fkey" FOREIGN KEY ("trackedProductId") REFERENCES "TrackedProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PinnedProduct" ADD CONSTRAINT "PinnedProduct_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PinnedProduct" ADD CONSTRAINT "PinnedProduct_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionProductPosition" ADD CONSTRAINT "CollectionProductPosition_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionProductPosition" ADD CONSTRAINT "CollectionProductPosition_trackedProductId_fkey" FOREIGN KEY ("trackedProductId") REFERENCES "TrackedProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionMembership" ADD CONSTRAINT "CollectionMembership_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionMembership" ADD CONSTRAINT "CollectionMembership_trackedProductId_fkey" FOREIGN KEY ("trackedProductId") REFERENCES "TrackedProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OriginalCollectionPosition" ADD CONSTRAINT "OriginalCollectionPosition_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CollectionMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStatusHistory" ADD CONSTRAINT "InventoryStatusHistory_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStatusHistory" ADD CONSTRAINT "InventoryStatusHistory_trackedProductId_fkey" FOREIGN KEY ("trackedProductId") REFERENCES "TrackedProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

