-- CreateTable
CREATE TABLE "CustomerCredit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customer_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "related_contract_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "CustomerCredit_customer_id_idx" ON "CustomerCredit"("customer_id");
