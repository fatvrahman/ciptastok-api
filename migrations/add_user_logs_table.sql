-- Script untuk menambahkan tabel user_logs
-- Tabel ini menyimpan log aktivitas user (login, logout, dll)

CREATE TABLE IF NOT EXISTS user_logs (
  log_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  aktivitas VARCHAR(50) NOT NULL COMMENT 'login, logout, dll',
  ip_address VARCHAR(45) NULL COMMENT 'IP address user',
  waktu DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_user_waktu (user_id, waktu),
  INDEX idx_waktu (waktu DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Log aktivitas user';

-- Contoh data dummy untuk testing (opsional)
-- INSERT INTO user_logs (user_id, aktivitas, ip_address, waktu) VALUES
-- (1, 'login', '192.168.1.1', NOW() - INTERVAL 2 HOUR),
-- (1, 'logout', '192.168.1.1', NOW() - INTERVAL 1 HOUR),
-- (2, 'login', '192.168.1.2', NOW() - INTERVAL 30 MINUTE);
