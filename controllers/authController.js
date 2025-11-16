// path: api/controllers/authController.js
import { pool } from '../config/db.js'; // <-- Tambah .js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { logUserActivity } from './userController.js'; // [BARU] Import helper log

// Helper untuk generate token dengan expiry 8 jam
const generateToken = (userId, roleId) => {
  return jwt.sign(
    { id: userId, role: roleId }, 
    process.env.JWT_SECRET || 'rahasia123', 
    { expiresIn: '8h' } 
  );
};

// --- [PERBAIKAN] Ganti 'exports.registerUser' menjadi 'export const' ---
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

    // Log aktivitas
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    const adminId = req.user?.user_id; // Jika ada admin yang register user
    if (adminId) {
      await logUserActivity(adminId, `Mendaftarkan user baru: ${username}`, ipAddress);
    }
    
    res.status(201).json({ 
      msg: 'User berhasil terdaftar',
      userId: result.insertId 
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

// --- [PERBAIKAN] Ganti 'exports.loginUser' menjadi 'export const' ---
export const loginUser = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ msg: 'Mohon masukkan username dan password.' });
  }

  try {
    const [users] = await pool.query(
      `SELECT u.*, r.nama_role 
       FROM users u 
       JOIN roles r ON u.role_id = r.role_id 
       WHERE u.username = ? AND u.is_active = 1`,
      [username]
    );

    if (users.length === 0) {
      return res.status(400).json({ msg: 'Username atau password salah.' });
    }

    const user = users[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Username atau password salah.' });
    }

    const token = generateToken(user.user_id, user.role_id);

    // [BARU] Log aktivitas login
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    await logUserActivity(user.user_id, 'login', ipAddress);

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
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

// [BARU] Logout user (untuk logging aktivitas)
export const logoutUser = async (req, res) => {
  try {
    const userId = req.user.user_id; // Dari middleware auth
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    
    await logUserActivity(userId, 'logout', ipAddress);
    
    res.json({ msg: 'Logout berhasil' });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

