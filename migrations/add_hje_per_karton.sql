-- Migration: Add hje_per_karton column to produk table
-- Date: 2025-11-16
-- Description: Menambahkan kolom HJE (Harga Jual Eceran) PER KARTON untuk menyimpan harga produk per karton

ALTER TABLE `produk` 
ADD COLUMN `hje_per_karton` DECIMAL(15,2) NULL COMMENT 'Harga Jual Eceran per Karton' AFTER `konversi_pcs`;

-- Verify
SELECT 'Column hje_per_karton added successfully' as status;
