-- Fix tipe data sistem_karton, sistem_tengah, sistem_pieces
-- Dari INT ke DECIMAL untuk support nilai desimal

-- WH01
ALTER TABLE `stok_wh01` 
MODIFY COLUMN `sistem_karton` DECIMAL(15,3) NULL DEFAULT 0 COMMENT 'Stok dalam karton (desimal untuk pecahan)',
MODIFY COLUMN `sistem_tengah` DECIMAL(15,3) NULL DEFAULT 0 COMMENT 'Stok dalam tengah/pack (desimal)',
MODIFY COLUMN `sistem_pieces` DECIMAL(15,3) NULL DEFAULT 0 COMMENT 'Stok dalam pieces/kecil (desimal)';

-- WH02
ALTER TABLE `stok_wh02` 
MODIFY COLUMN `sistem_karton` DECIMAL(15,3) NULL DEFAULT 0 COMMENT 'Stok dalam karton (desimal untuk pecahan)',
MODIFY COLUMN `sistem_tengah` DECIMAL(15,3) NULL DEFAULT 0 COMMENT 'Stok dalam tengah/pack (desimal)',
MODIFY COLUMN `sistem_pieces` DECIMAL(15,3) NULL DEFAULT 0 COMMENT 'Stok dalam pieces/kecil (desimal)';

-- WH03
ALTER TABLE `stok_wh03` 
MODIFY COLUMN `sistem_karton` DECIMAL(15,3) NULL DEFAULT 0 COMMENT 'Stok dalam karton (desimal untuk pecahan)',
MODIFY COLUMN `sistem_tengah` DECIMAL(15,3) NULL DEFAULT 0 COMMENT 'Stok dalam tengah/pack (desimal)',
MODIFY COLUMN `sistem_pieces` DECIMAL(15,3) NULL DEFAULT 0 COMMENT 'Stok dalam pieces/kecil (desimal)';
