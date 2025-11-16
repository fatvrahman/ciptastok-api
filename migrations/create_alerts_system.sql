-- ==========================================
-- MIGRATION: System Alerts Management
-- Created: 2025-11-16
-- Description: Tabel untuk mengelola alert sistem
-- ==========================================

-- Tabel alert_types: jenis-jenis alert yang tersedia
CREATE TABLE IF NOT EXISTS alert_types (
  alert_type_id INT AUTO_INCREMENT PRIMARY KEY,
  type_code VARCHAR(50) NOT NULL UNIQUE COMMENT 'Kode unik alert (e.g., LOGIN_WELCOME, LOW_STOCK)',
  type_name VARCHAR(100) NOT NULL COMMENT 'Nama alert yang ditampilkan',
  description TEXT COMMENT 'Deskripsi kegunaan alert',
  default_enabled BOOLEAN DEFAULT true COMMENT 'Status default saat pertama kali',
  is_system BOOLEAN DEFAULT false COMMENT 'Alert sistem yang tidak bisa dihapus',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabel alert_settings: pengaturan alert per user atau global
CREATE TABLE IF NOT EXISTS alert_settings (
  setting_id INT AUTO_INCREMENT PRIMARY KEY,
  alert_type_id INT NOT NULL,
  user_id INT NULL COMMENT 'NULL = global setting, filled = per-user override',
  is_enabled BOOLEAN DEFAULT true,
  custom_message TEXT COMMENT 'Custom message jika user ingin ganti',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (alert_type_id) REFERENCES alert_types(alert_type_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  UNIQUE KEY unique_alert_user (alert_type_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabel user_alerts: riwayat alert yang sudah ditampilkan ke user
CREATE TABLE IF NOT EXISTS user_alerts (
  alert_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  alert_type_id INT NOT NULL,
  alert_message TEXT NOT NULL,
  alert_data JSON COMMENT 'Data tambahan (e.g., tasks, stats)',
  is_read BOOLEAN DEFAULT false,
  shown_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (alert_type_id) REFERENCES alert_types(alert_type_id) ON DELETE CASCADE,
  INDEX idx_user_read (user_id, is_read),
  INDEX idx_shown_at (shown_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ==========================================
-- INSERT DEFAULT ALERT TYPES
-- ==========================================

INSERT INTO alert_types (type_code, type_name, description, default_enabled, is_system) VALUES
('LOGIN_WELCOME', 'Welcome Alert Saat Login', 'Tampilkan pesan selamat datang dengan ringkasan tugas/data saat user login', true, true),
('LOW_STOCK', 'Alert Stok Rendah', 'Notifikasi ketika stok produk di bawah threshold', true, true),
('PENDING_OPNAME', 'Alert Opname Pending', 'Notifikasi jika ada tugas opname yang belum selesai', true, true),
('SYSTEM_MAINTENANCE', 'Alert Maintenance Sistem', 'Pemberitahuan maintenance atau update sistem', false, true),
('NEW_ASSIGNMENT', 'Alert Penugasan Baru', 'Notifikasi saat mendapat penugasan opname baru', true, true);

-- ==========================================
-- INSERT GLOBAL DEFAULT SETTINGS
-- ==========================================

-- Global settings (user_id = NULL)
INSERT INTO alert_settings (alert_type_id, user_id, is_enabled) 
SELECT alert_type_id, NULL, default_enabled 
FROM alert_types;

-- ==========================================
-- VERIFICATION QUERIES
-- ==========================================

-- Check alert types
SELECT * FROM alert_types;

-- Check global settings
SELECT 
  at.type_name,
  at.description,
  als.is_enabled as global_enabled
FROM alert_types at
LEFT JOIN alert_settings als ON at.alert_type_id = als.alert_type_id AND als.user_id IS NULL;

-- Contoh: Cek alert setting untuk user tertentu
-- SELECT 
--   at.type_name,
--   COALESCE(user_als.is_enabled, global_als.is_enabled) as is_enabled
-- FROM alert_types at
-- LEFT JOIN alert_settings global_als ON at.alert_type_id = global_als.alert_type_id AND global_als.user_id IS NULL
-- LEFT JOIN alert_settings user_als ON at.alert_type_id = user_als.alert_type_id AND user_als.user_id = 1;
