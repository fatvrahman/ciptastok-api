-- INSTRUKSI MIGRATION
-- Jalankan query SQL ini di phpMyAdmin atau MySQL Workbench

-- 1. Buka phpMyAdmin
-- 2. Pilih database 'ciptastok_db'
-- 3. Klik tab 'SQL'
-- 4. Copy-paste query di bawah ini dan klik 'Go'

-- ==========================================
-- Migration: Add email column to users table
-- Date: 2025-11-14
-- ==========================================

-- Add email column
ALTER TABLE `users` 
ADD COLUMN `email` VARCHAR(255) NULL AFTER `username`;

-- Update existing users with email addresses
UPDATE `users` SET `email` = 'herdi@ciptastok.com' WHERE `user_id` = 1;
UPDATE `users` SET `email` = 'yopi@ciptastok.com' WHERE `user_id` = 2;
UPDATE `users` SET `email` = 'adi@ciptastok.com' WHERE `user_id` = 3;
UPDATE `users` SET `email` = 'joko@ciptastok.com' WHERE `user_id` = 4;

-- Add index for email (optional, for better performance)
CREATE INDEX idx_users_email ON `users` (`email`);

-- ==========================================
-- Verify the changes
-- ==========================================
SELECT * FROM `users`;
