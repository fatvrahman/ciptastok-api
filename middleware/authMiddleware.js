// path: api/middleware/authMiddleware.js
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js'; // Pastikan .js ada
import 'dotenv/config';

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Check if token is expired (additional check)
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp && decoded.exp < now) {
        return res.status(401).json({ msg: 'Token expired' });
      }

      const [users] = await pool.query(
        'SELECT user_id, nama_lengkap, role_id FROM users WHERE user_id = ? AND is_active = 1', 
        [decoded.id]
      );

      if (users.length === 0) {
        return res.status(401).json({ msg: 'User tidak ditemukan atau tidak aktif' });
      }
      req.user = users[0];
      next();
    } catch (error) {
      console.error(error);
      res.status(401).json({ msg: 'Token tidak valid, otorisasi ditolak' });
    }
  }

  if (!token) {
    res.status(401).json({ msg: 'Tidak ada token, otorisasi ditolak' });
  }
};

const adminOnly = (req, res, next) => {
    // Asumsi role_id 1 adalah Admin
    if (req.user && req.user.role_id === 1) {
        next();
    } else {
        res.status(403).json({ msg: 'Akses ditolak. Hanya untuk Admin.' });
    }
};

// --- [PERBAIKAN] ---
// Ekspor kedua fungsi menggunakan ESM
export { protect, adminOnly };

// Alias untuk backward compatibility
export const authenticateToken = protect;

