-- Migration: Remove kategori_divisi table (redundant with divisi table)
-- Created: 2025-11-16
-- Reason: Backend sudah menggunakan divisi.nama_divisi langsung, tidak perlu mapping lagi

-- Drop foreign key constraints first if any exist
SET FOREIGN_KEY_CHECKS = 0;

-- Drop the kategori_divisi table
DROP TABLE IF EXISTS `kategori_divisi`;

-- Also drop kategori table if empty/unused
DROP TABLE IF EXISTS `kategori`;

SET FOREIGN_KEY_CHECKS = 1;

-- DONE: kategori_divisi dan kategori table dihapus
-- Backend sekarang langsung menggunakan tabel divisi (kode_divisi + nama_divisi)
