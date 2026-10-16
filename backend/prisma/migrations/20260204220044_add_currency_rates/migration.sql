/*
  Warnings:

  - Made the column `currencyCode` on table `Movement` required. This step will fail if there are existing NULL values in that column.
  - Made the column `rateAtTransaction` on table `Movement` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Movement" ALTER COLUMN "currencyCode" SET NOT NULL,
ALTER COLUMN "rateAtTransaction" SET NOT NULL;

-- CreateTable
CREATE TABLE "CurrencyRate" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "rate" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CurrencyRate_code_effectiveFrom_idx" ON "CurrencyRate"("code", "effectiveFrom");
