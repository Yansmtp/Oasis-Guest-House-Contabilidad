CREATE TABLE "InvoiceSequence" (
    "year" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("year")
);
