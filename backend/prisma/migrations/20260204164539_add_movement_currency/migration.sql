-- AlterTable
ALTER TABLE "Movement" ADD COLUMN     "currencyCode" TEXT DEFAULT 'USD',
ADD COLUMN     "rateAtTransaction" DECIMAL(65,30) DEFAULT 1;
