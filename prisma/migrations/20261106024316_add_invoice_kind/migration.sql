-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contract_id" TEXT NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'rent',
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
INSERT INTO "new_Invoice" ("contract_id", "due_date", "gross_cents", "id", "issued_at", "net_cents", "paid_at", "payment_deadline", "sequence_number", "status", "vat_cents", "vat_rate_percent") SELECT "contract_id", "due_date", "gross_cents", "id", "issued_at", "net_cents", "paid_at", "payment_deadline", "sequence_number", "status", "vat_cents", "vat_rate_percent" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE INDEX "Invoice_contract_id_idx" ON "Invoice"("contract_id");
CREATE UNIQUE INDEX "Invoice_contract_id_sequence_number_key" ON "Invoice"("contract_id", "sequence_number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
