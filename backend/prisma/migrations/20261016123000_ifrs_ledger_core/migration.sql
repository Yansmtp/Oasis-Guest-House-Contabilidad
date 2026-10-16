CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "MovementStatus" AS ENUM ('POSTED', 'REVERSED');
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "JournalEntryKind" AS ENUM ('GENERAL', 'INVENTORY_OPENING', 'INVENTORY_MOVEMENT', 'REVERSAL');

ALTER TABLE "Company"
ADD COLUMN "functionalCurrencyCode" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN "inventoryAccountId" INTEGER,
ADD COLUMN "accountingCutoverAt" DATE;

ALTER TABLE "Movement"
ADD COLUMN "status" "MovementStatus" NOT NULL DEFAULT 'POSTED',
ADD COLUMN "counterpartAccountId" INTEGER,
ADD COLUMN "reversalOfId" INTEGER,
ADD COLUMN "reversedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Movement_reversalOfId_key" ON "Movement"("reversalOfId");
CREATE INDEX "Movement_status_date_idx" ON "Movement"("status", "date");

CREATE TABLE "Account" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "parentId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingPeriod" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccountingPeriod_date_range_check" CHECK ("startsAt" <= "endsAt")
);

CREATE TABLE "JournalEntry" (
    "id" SERIAL NOT NULL,
    "entryNumber" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "kind" "JournalEntryKind" NOT NULL DEFAULT 'GENERAL',
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "periodId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "postedById" INTEGER,
    "postedAt" TIMESTAMP(3),
    "reversalOfId" INTEGER,
    "sourceMovementId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalLine" (
    "id" SERIAL NOT NULL,
    "journalEntryId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "productId" INTEGER,
    "costCenterId" INTEGER,
    "description" TEXT,
    "debit" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "credit" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "currencyCode" TEXT,
    "originalDebit" DECIMAL(20,6),
    "originalCredit" DECIMAL(20,6),
    "exchangeRate" DECIMAL(20,10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JournalLine_nonnegative_amounts_check" CHECK ("debit" >= 0 AND "credit" >= 0),
    CONSTRAINT "JournalLine_single_sided_check" CHECK (("debit" = 0) <> ("credit" = 0))
);

CREATE TABLE "Currency" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

INSERT INTO "Currency" ("code", "name", "isDefault", "updatedAt")
VALUES ('USD', 'US Dollar', true, CURRENT_TIMESTAMP), ('CUP', 'Peso Cubano', false, CURRENT_TIMESTAMP);

INSERT INTO "CurrencyRate" ("code", "rate", "effectiveFrom")
SELECT 'USD', 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "CurrencyRate" WHERE "code" = 'USD');

INSERT INTO "CurrencyRate" ("code", "rate", "effectiveFrom")
SELECT 'CUP', 0.0083, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "CurrencyRate" WHERE "code" = 'CUP');

CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");
CREATE UNIQUE INDEX "Currency_single_default_key" ON "Currency"("isDefault") WHERE "isDefault" = true;
CREATE INDEX "Account_type_isActive_idx" ON "Account"("type", "isActive");
CREATE INDEX "Account_parentId_idx" ON "Account"("parentId");
CREATE UNIQUE INDEX "AccountingPeriod_name_key" ON "AccountingPeriod"("name");
CREATE INDEX "AccountingPeriod_startsAt_endsAt_status_idx" ON "AccountingPeriod"("startsAt", "endsAt", "status");
CREATE UNIQUE INDEX "JournalEntry_entryNumber_key" ON "JournalEntry"("entryNumber");
CREATE UNIQUE INDEX "JournalEntry_reversalOfId_key" ON "JournalEntry"("reversalOfId");
CREATE UNIQUE INDEX "JournalEntry_sourceMovementId_key" ON "JournalEntry"("sourceMovementId");
CREATE INDEX "JournalEntry_date_status_idx" ON "JournalEntry"("date", "status");
CREATE INDEX "JournalEntry_periodId_status_idx" ON "JournalEntry"("periodId", "status");
CREATE INDEX "JournalEntry_createdById_createdAt_idx" ON "JournalEntry"("createdById", "createdAt");
CREATE INDEX "JournalLine_journalEntryId_idx" ON "JournalLine"("journalEntryId");
CREATE INDEX "JournalLine_accountId_journalEntryId_idx" ON "JournalLine"("accountId", "journalEntryId");
CREATE INDEX "JournalLine_productId_journalEntryId_idx" ON "JournalLine"("productId", "journalEntryId");
CREATE INDEX "JournalLine_costCenterId_journalEntryId_idx" ON "JournalLine"("costCenterId", "journalEntryId");

ALTER TABLE "Account"
ADD CONSTRAINT "Account_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Company"
ADD CONSTRAINT "Company_inventoryAccountId_fkey"
FOREIGN KEY ("inventoryAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Movement"
ADD CONSTRAINT "Movement_counterpartAccountId_fkey"
FOREIGN KEY ("counterpartAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AccountingPeriod"
ADD CONSTRAINT "AccountingPeriod_closedById_fkey"
FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JournalEntry"
ADD CONSTRAINT "JournalEntry_periodId_fkey"
FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "JournalEntry_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "JournalEntry_postedById_fkey"
FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "JournalEntry_reversalOfId_fkey"
FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "JournalEntry_sourceMovementId_fkey"
FOREIGN KEY ("sourceMovementId") REFERENCES "Movement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Movement"
ADD CONSTRAINT "Movement_reversalOfId_fkey"
FOREIGN KEY ("reversalOfId") REFERENCES "Movement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JournalLine"
ADD CONSTRAINT "JournalLine_journalEntryId_fkey"
FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "JournalLine_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "JournalLine_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "JournalLine_costCenterId_fkey"
FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
