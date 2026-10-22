ALTER TYPE "MovementStatus" ADD VALUE 'PENDING';
ALTER TYPE "MovementStatus" ADD VALUE 'REJECTED';

ALTER TABLE "Movement"
ADD COLUMN "reviewedById" INTEGER,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "rejectionReason" TEXT;

ALTER TABLE "Movement"
ADD CONSTRAINT "Movement_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Movement_status_createdAt_idx" ON "Movement"("status", "createdAt");

UPDATE "User" SET "role" = 'WAREHOUSE' WHERE UPPER("role") = 'USER';
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'WAREHOUSE';
