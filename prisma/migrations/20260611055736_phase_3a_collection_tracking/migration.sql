-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "shopifyCollectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Collection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CollectionProductPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "trackedProductId" TEXT NOT NULL,
    "originalPosition" INTEGER NOT NULL,
    "currentPosition" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CollectionProductPosition_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionProductPosition_trackedProductId_fkey" FOREIGN KEY ("trackedProductId") REFERENCES "TrackedProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Collection_shopId_idx" ON "Collection"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_shopId_shopifyCollectionId_key" ON "Collection"("shopId", "shopifyCollectionId");

-- CreateIndex
CREATE INDEX "CollectionProductPosition_collectionId_idx" ON "CollectionProductPosition"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionProductPosition_collectionId_trackedProductId_key" ON "CollectionProductPosition"("collectionId", "trackedProductId");
