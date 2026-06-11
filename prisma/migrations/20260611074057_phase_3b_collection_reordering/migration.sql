-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Collection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "shopifyCollectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" TEXT NOT NULL DEFAULT 'MANUAL',
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Collection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Collection" ("createdAt", "id", "lastSyncedAt", "shopId", "shopifyCollectionId", "title", "updatedAt") SELECT "createdAt", "id", "lastSyncedAt", "shopId", "shopifyCollectionId", "title", "updatedAt" FROM "Collection";
DROP TABLE "Collection";
ALTER TABLE "new_Collection" RENAME TO "Collection";
CREATE INDEX "Collection_shopId_idx" ON "Collection"("shopId");
CREATE UNIQUE INDEX "Collection_shopId_shopifyCollectionId_key" ON "Collection"("shopId", "shopifyCollectionId");
CREATE TABLE "new_CollectionProductPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "trackedProductId" TEXT NOT NULL,
    "originalPosition" INTEGER NOT NULL,
    "currentPosition" INTEGER NOT NULL,
    "restorePositionCaptured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CollectionProductPosition_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionProductPosition_trackedProductId_fkey" FOREIGN KEY ("trackedProductId") REFERENCES "TrackedProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CollectionProductPosition" ("collectionId", "createdAt", "currentPosition", "id", "originalPosition", "trackedProductId", "updatedAt") SELECT "collectionId", "createdAt", "currentPosition", "id", "originalPosition", "trackedProductId", "updatedAt" FROM "CollectionProductPosition";
DROP TABLE "CollectionProductPosition";
ALTER TABLE "new_CollectionProductPosition" RENAME TO "CollectionProductPosition";
CREATE INDEX "CollectionProductPosition_collectionId_idx" ON "CollectionProductPosition"("collectionId");
CREATE UNIQUE INDEX "CollectionProductPosition_collectionId_trackedProductId_key" ON "CollectionProductPosition"("collectionId", "trackedProductId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
