-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customer_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "term_months" INTEGER NOT NULL,
    "financed_amount_cents" INTEGER NOT NULL,
    "monthly_rent_with_vat_cents" INTEGER NOT NULL,
    "price_list_version" INTEGER NOT NULL,
    "answers_json" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decision_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" DATETIME
);

-- CreateIndex
CREATE INDEX "Application_customer_id_idx" ON "Application"("customer_id");
