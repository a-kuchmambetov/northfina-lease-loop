-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contract_id" TEXT NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "due_date" TEXT NOT NULL,
    "payment_deadline" TEXT NOT NULL,
    "net_cents" INTEGER NOT NULL,
    "vat_rate_percent" REAL NOT NULL,
    "vat_cents" INTEGER NOT NULL,
    "gross_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "issued_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" DATETIME
);

-- CreateIndex
CREATE INDEX "Invoice_contract_id_idx" ON "Invoice"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_contract_id_sequence_number_key" ON "Invoice"("contract_id", "sequence_number");
