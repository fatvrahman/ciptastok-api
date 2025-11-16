// path: api/config/db.js
import mysql from 'mysql2/promise'; // <-- [UBAH] Gunakan import
import 'dotenv/config'; // <-- [UBAH] Gunakan import

// Buat "connection pool"
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Fungsi untuk mengetes koneksi
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('DB Connected!');
    connection.release(); // Kembalikan koneksi ke pool
  } catch (error) {
    console.error('DB Not Connected:', error.message);
  }
}

// [UBAH] Ekspor menggunakan ESM
export {
  pool,
  testConnection
};

