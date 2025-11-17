import { pool } from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { logUserActivity } from './userController.js';

// ... (Fungsi generateToken tidak berubah)
const generateToken = (userId, roleId) => {
  return jwt.sign(
    { id: userId, role: roleId },
    process.env.JWT_SECRET || 'rahasia123',
    { expiresIn: '8h' }
  );
};

// ... (Fungsi registerUser tidak berubah)
export const registerUser = async (req, res) => {
  const { nama_lengkap, username, email, password, role_id, divisi_id } = req.body;

  if (!nama_lengkap || !username || !password || !role_id) {
    return res.status(400).json({ msg: 'Mohon isi semua field yang wajib.' });
  }

  try {
    const [existingUser] = await pool.query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({ msg: 'Username sudah terpakai.' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const [result] = await pool.query(
      'INSERT INTO users (nama_lengkap, username, email, password_hash, role_id, divisi_id) VALUES (?, ?, ?, ?, ?, ?)',
      [nama_lengkap, username, email || null, password_hash, role_id, divisi_id || null]
    );

    const ipAddress = req.ip || req.connection.remoteAddress || null;
    const adminId = req.user?.user_id; 
    if (adminId) {
      await logUserActivity(adminId, `Mendaftarkan user baru: ${username}`, ipAddress);
    }
    
    res.status(201).json({ 
      msg: 'User berhasil terdaftar',
      userId: result.insertId 
    });

  } catch (error) {
    console.error('Error di registerUser:', error.message);
    res.status(500).send('Server Error');
  }
};


// --- [PERBAIKAN BESAR] FUNGSI LOGIN DENGAN DEBUGGING ---
export const loginUser = async (req, res) => {
  const { username, password } = req.body;
  console.log(`[DEBUG] Menerima permintaan login untuk: ${username}`); // <-- LOG BARU

  if (!username || !password) {
    return res.status(400).json({ msg: 'Mohon masukkan username dan password.' });
  }

  try {
    console.log('[DEBUG] Mencoba query ke database (JOIN roles)...'); // <-- LOG BARU
    
    const [users] = await pool.query(
      `SELECT u.*, r.nama_role 
       FROM users u 
       JOIN roles r ON u.role_id = r.role_id 
       WHERE u.username = ? AND u.is_active = 1`,
      [username]
    );

    console.log(`[DEBUG] Query database SELESAI. User ditemukan: ${users.length}`); // <-- LOG BARU

    if (users.length === 0) {
      console.log('[DEBUG] Login gagal: User tidak ditemukan atau tidak aktif.');
      return res.status(400).json({ msg: 'Username atau password salah.' });
    }

    const user = users[0];
    console.log(`[DEBUG] User ditemukan: ${user.username}. Memeriksa password...`);

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      console.log('[DEBUG] Login gagal: Password tidak cocok.');
      return res.status(400).json({ msg: 'Username atau password salah.' });
    }

    console.log('[DEBUG] Password cocok. Membuat token...');
    const token = generateToken(user.user_id, user.role_id);
 
    // const ipAddress = req.ip || req.connection.remoteAddress || null;
    // await logUserActivity(user.user_id, 'login', ipAddress); // <-- Biarkan ini tidak aktif
    
    console.log('[DEBUG] Login BERHASIL. Mengirim respons token.'); // <-- LOG BARU
    res.json({
      token,
      user: {
        id: user.user_id,
        nama_lengkap: user.nama_lengkap,
        username: user.username,
        email: user.email,
        nama_role: user.nama_role,
        role_id: user.role_id,
        divisi_id: user.divisi_id
      }
    });

  } catch (error) {
    // --- [INI BAGIAN PALING PENTING] ---
    console.error('!!! ERROR BESAR SAAT LOGIN !!!');
    console.error('Error Code:', error.code); // e.g., 'ETIMEDOUT', 'ECONNRESET'
    console.error('Error Message:', error.message);
    console.error('Error Stack:', error.stack);
    
    // Kirim error yang sebenarnya ke frontend
    res.status(500).json({ 
      msg: 'Terjadi Server Error Saat Login', 
      error: error.message,
      code: error.code || 'UNKNOWN'
    });
    // --- Batas Perbaikan Catch ---
  }
};

// ... (Fungsi logout tidak berubah)
export const logoutUser = async (req, res) => {
  try {
    const userId = req.user.user_id; 
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    
    await logUserActivity(userId, 'logout', ipAddress);
    
    res.json({ msg: 'Logout berhasil' });
  } catch (error) {
    console.error('Error di logoutUser:', error.message);
    res.status(500).send('Server Error');
  }
};
