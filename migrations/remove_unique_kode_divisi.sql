-- Migration: Remove UNIQUE constraint from kode_divisi
-- Date: November 16, 2025
-- Purpose: Allow flexible mapping where one kode can have different nama_divisi
-- Example: MU245 can be Cereal OR Beverage, not tied to one nama

-- Drop the unique constraint on kode_divisi
ALTER TABLE `divisi` 
DROP INDEX `kode_divisi`;

-- Add regular index for performance (optional but recommended)
ALTER TABLE `divisi`
ADD INDEX `idx_kode_divisi` (`kode_divisi`);

-- Verification query (run after migration)
-- SELECT * FROM divisi ORDER BY kode_divisi, nama_divisi;
