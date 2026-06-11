-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Collection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "shopifyCollectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" TEXT NOT NULL DEFAULT 'MANUAL',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Collection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Collection" ("createdAt", "id", "lastSyncedAt", "shopId", "shopifyCollectionId", "sortOrder", "title", "updatedAt") SELECT "createdAt", "id", "lastSyncedAt", "shopId", "shopifyCollectionId", "sortOrder", "title", "updatedAt" FROM "Collection";
DROP TABLE "Collection";
ALTER TABLE "new_Collection" RENAME TO "Collection";
CREATE INDEX "Collection_shopId_idx" ON "Collection"("shopId");
CREATE INDEX "Collection_shopId_enabled_idx" ON "Collection"("shopId", "enabled");
CREATE UNIQUE INDEX "Collection_shopId_shopifyCollectionId_key" ON "Collection"("shopId", "shopifyCollectionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
