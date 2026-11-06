-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "asset_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "start_date" TEXT NOT NULL,
    "term_months" INTEGER NOT NULL,
    "price_list_version" INTEGER NOT NULL,
    "list_price_cents" INTEGER NOT NULL,
    "down_payment_cents" INTEGER NOT NULL,
    "financed_cents" INTEGER NOT NULL,
    "monthly_net_rent_cents" INTEGER NOT NULL,
    "buyout_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "signed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Contract" ("asset_id", "buyout_cents", "customer_id", "down_payment_cents", "financed_cents", "id", "list_price_cents", "monthly_net_rent_cents", "price_list_version", "signed_at", "start_date", "term_months") SELECT "asset_id", "buyout_cents", "customer_id", "down_payment_cents", "financed_cents", "id", "list_price_cents", "monthly_net_rent_cents", "price_list_version", "signed_at", "start_date", "term_months" FROM "Contract";
DROP TABLE "Contract";
ALTER TABLE "new_Contract" RENAME TO "Contract";
CREATE INDEX "Contract_asset_id_idx" ON "Contract"("asset_id");
CREATE INDEX "Contract_customer_id_idx" ON "Contract"("customer_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
