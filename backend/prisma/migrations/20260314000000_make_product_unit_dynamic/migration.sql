-- Convert fixed unit enum to free-text units
ALTER TABLE "Product"
ALTER COLUMN "unit" TYPE TEXT USING "unit"::text;

DROP TYPE IF EXISTS "UnitType";
