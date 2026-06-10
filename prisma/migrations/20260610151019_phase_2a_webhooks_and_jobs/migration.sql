-- CreateTable
CREATE TABLE "TrackedProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "tracksInventory" BOOLEAN NOT NULL DEFAULT false,
    "inventoryPolicy" TEXT NOT NULL DEFAULT 'DENY',
    "totalAvailable" INTEGER NOT NULL DEFAULT 0,
    "isSoldOut" BOOLEAN NOT NULL DEFAULT false,
    "soldOutAt" DATETIME,
    "backInStockAt" DATETIME,
    "lastWebhookAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrackedProduct_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CollectionMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "trackedProductId" TEXT NOT NULL,
    "shopifyCollectionId" TEXT NOT NULL,
    "collectionTitle" TEXT,
    "sortOrder" TEXT NOT NULL DEFAULT 'MANUAL',
    "isManualSort" BOOLEAN NOT NULL DEFAULT true,
    "currentPosition" INTEGER,
    "isAtBottom" BOOLEAN NOT NULL DEFAULT false,
    "removedFromCollection" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CollectionMembership_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionMembership_trackedProductId_fkey" FOREIGN KEY ("trackedProductId") REFERENCES "TrackedProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OriginalCollectionPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "membershipId" TEXT NOT NULL,
    "originalPosition" INTEGER NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" DATETIME,
    "restoreTarget" TEXT,
    CONSTRAINT "OriginalCollectionPosition_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CollectionMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryStatusHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "trackedProductId" TEXT NOT NULL,
    "previousStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "totalAvailable" INTEGER NOT NULL DEFAULT 0,
    "triggerSource" TEXT NOT NULL,
    "shopifyWebhookId" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryStatusHistory_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryStatusHistory_trackedProductId_fkey" FOREIGN KEY ("trackedProductId") REFERENCES "TrackedProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyWebhookId" TEXT NOT NULL,
    "shopId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 10,
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "dedupeKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TrackedProduct_shopId_isSoldOut_idx" ON "TrackedProduct"("shopId", "isSoldOut");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedProduct_shopId_shopifyProductId_key" ON "TrackedProduct"("shopId", "shopifyProductId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionMembership_shopId_shopifyCollectionId_trackedProductId_key" ON "CollectionMembership"("shopId", "shopifyCollectionId", "trackedProductId");

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
