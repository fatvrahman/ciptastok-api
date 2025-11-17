import mysql from 'mysql2/promise';
import 'dotenv/config';

// --- [PERBAIKAN] Menggunakan createPool dengan opsi lengkap ---
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Opsi penting untuk menjaga koneksi di production
  keepAlive: true,
  connectTimeout: 20000, // 20 detik timeout koneksi
});

// --- [PERBAIKAN] Fungsi testConnection yang lebih kuat ---
async function testConnection() {
  try {
    // Meminta satu koneksi dari pool
    const connection = await pool.getConnection();
    console.log('DB Connected!');
    // Melepaskan koneksi kembali ke pool
    connection.release();
  } catch (error) {
    // Menggunakan console.error untuk error
    console.error('DB Not Connected:', error.message);
    // Keluar dari proses jika database gagal terhubung saat startup
    process.exit(1);
  }
}

// --- [SESUAIKAN] Ekspor menggunakan NAMED EXPORT (bukan default) ---
// Ini agar 'authController.js' Anda (import { pool }) bisa berjalan
export {
  pool,
  testConnection
};
