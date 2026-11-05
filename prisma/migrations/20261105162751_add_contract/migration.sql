-- CreateTable
CREATE TABLE "Contract" (
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
    "signed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Contract_asset_id_idx" ON "Contract"("asset_id");

-- CreateIndex
CREATE INDEX "Contract_customer_id_idx" ON "Contract"("customer_id");
