/*
  Warnings:

  - A unique constraint covering the columns `[application_id]` on the table `Contract` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Contract" ADD COLUMN "application_id" TEXT;
ALTER TABLE "Contract" ADD COLUMN "signed_name" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Contract_application_id_key" ON "Contract"("application_id");
