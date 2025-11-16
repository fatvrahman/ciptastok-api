-- Migration: Tambah tabel untuk mapping kategori produk ke divisi
-- Tanggal: 2025-11-16
-- Tujuan: Mapping nama kategori di template Excel ke kode_divisi

-- STEP 1: Tambahkan divisi baru jika belum ada (HARUS DULUAN!)
-- M3: BEVERAGE & HOME CARE
INSERT IGNORE INTO `divisi` (`nama_divisi`, `kode_divisi`) VALUES
('M3 - Beverage & Home Care', 'M3');

-- BIS: BISCUIT  
INSERT IGNORE INTO `divisi` (`nama_divisi`, `kode_divisi`) VALUES
('BIS - Biscuit', 'BIS');

-- Update nama divisi yang sudah ada
UPDATE `divisi` SET `nama_divisi` = 'MU245 - Cereal, Coffee, Noodle' WHERE `kode_divisi` = 'MU245';
UPDATE `divisi` SET `nama_divisi` = 'CWC - Candy, Wafer, Jelly' WHERE `kode_divisi` = 'CWC';

-- STEP 2: Buat tabel kategori_divisi
CREATE TABLE IF NOT EXISTS `kategori_divisi` (
  `kategori_divisi_id` int NOT NULL AUTO_INCREMENT,
  `nama_kategori` varchar(100) NOT NULL COMMENT 'Nama kategori dari template Excel (BISCUIT, CANDY, dll)',
  `divisi_id` int NOT NULL COMMENT 'Foreign key ke tabel divisi',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`kategori_divisi_id`),
  UNIQUE KEY `unique_kategori` (`nama_kategori`),
  KEY `divisi_id` (`divisi_id`),
  CONSTRAINT `kategori_divisi_ibfk_1` FOREIGN KEY (`divisi_id`) REFERENCES `divisi` (`divisi_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- STEP 3: Insert data mapping berdasarkan gambar yang diberikan (IGNORE jika sudah ada)
-- CWC: CANDY, WAFER, JELLY
INSERT IGNORE INTO `kategori_divisi` (`nama_kategori`, `divisi_id`) VALUES
('CANDY', (SELECT divisi_id FROM divisi WHERE kode_divisi = 'CWC')),
('WAFER', (SELECT divisi_id FROM divisi WHERE kode_divisi = 'CWC')),
('JELLY', (SELECT divisi_id FROM divisi WHERE kode_divisi = 'CWC'));

-- M3: BEVERAGE, HOME CARE
INSERT IGNORE INTO `kategori_divisi` (`nama_kategori`, `divisi_id`) VALUES
('BEVERAGE', (SELECT divisi_id FROM divisi WHERE kode_divisi = 'M3')),
('HOME CARE', (SELECT divisi_id FROM divisi WHERE kode_divisi = 'M3'));

-- MU245: CEREAL, COFFEE, NOODLE
INSERT IGNORE INTO `kategori_divisi` (`nama_kategori`, `divisi_id`) VALUES
('CEREAL', (SELECT divisi_id FROM divisi WHERE kode_divisi = 'MU245')),
('COFFEE', (SELECT divisi_id FROM divisi WHERE kode_divisi = 'MU245')),
('NOODLE', (SELECT divisi_id FROM divisi WHERE kode_divisi = 'MU245'));

-- BIS: BISCUIT
INSERT IGNORE INTO `kategori_divisi` (`nama_kategori`, `divisi_id`) VALUES
('BISCUIT', (SELECT divisi_id FROM divisi WHERE kode_divisi = 'BIS'));

-- Tambah kolom konversi ke tabel produk (untuk KONVERSI TENGAH dan KONVERSI PCS)
ALTER TABLE `produk` 
ADD COLUMN `konversi_tengah` int DEFAULT NULL COMMENT 'Konversi karton ke tengah' AFTER `barcode`,
ADD COLUMN `konversi_pcs` int DEFAULT NULL COMMENT 'Konversi karton ke pieces' AFTER `konversi_tengah`;
