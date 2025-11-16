-- Migration: Add total_in_pcs column to produk table
-- Date: November 16, 2025
-- Purpose: Add column to track total stock in pieces (accumulated from all warehouses)
-- Based on user requirement: Show total accumulated stock in PCS for "Stok Tersedia" card

-- Add total_in_pcs column after konversi_pcs
ALTER TABLE `produk` 
ADD COLUMN `total_in_pcs` INT DEFAULT 0 AFTER `konversi_pcs`;

-- Add index for better query performance
ALTER TABLE `produk`
ADD INDEX `idx_total_in_pcs` (`total_in_pcs`);

-- Optional: Update existing records with calculated total from all warehouses
-- This will sum up stock from stok_wh01, stok_wh02, stok_wh03
UPDATE produk p
SET p.total_in_pcs = (
    COALESCE((SELECT SUM(stok) FROM stok_wh01 WHERE pcode = p.pcode), 0) +
    COALESCE((SELECT SUM(stok) FROM stok_wh02 WHERE pcode = p.pcode), 0) +
    COALESCE((SELECT SUM(stok) FROM stok_wh03 WHERE pcode = p.pcode), 0)
);

-- Verification query (run after migration)
-- SELECT pcode, nama_barang, total_in_pcs FROM produk ORDER BY total_in_pcs DESC LIMIT 10;
