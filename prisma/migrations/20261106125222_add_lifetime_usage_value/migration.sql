-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "model_year" INTEGER NOT NULL,
    "serial_number" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "usage_unit" TEXT NOT NULL,
    "usage_value" INTEGER NOT NULL,
    "lifetime_usage_value" INTEGER NOT NULL DEFAULT 0,
    "previous_lives" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_Asset" ("category", "condition", "created_at", "id", "make", "model", "model_year", "previous_lives", "serial_number", "status", "updated_at", "usage_unit", "usage_value") SELECT "category", "condition", "created_at", "id", "make", "model", "model_year", "previous_lives", "serial_number", "status", "updated_at", "usage_unit", "usage_value" FROM "Asset";
DROP TABLE "Asset";
ALTER TABLE "new_Asset" RENAME TO "Asset";
CREATE UNIQUE INDEX "Asset_serial_number_key" ON "Asset"("serial_number");
CREATE INDEX "Asset_category_idx" ON "Asset"("category");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill: pre-reset history isn't recoverable, so today's single counter is the best
-- available approximation of lifetime usage (KNOWN_ISSUES.md item 5).
UPDATE "Asset" SET "lifetime_usage_value" = "usage_value";
