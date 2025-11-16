// path: api/controllers/userController.js
import { pool } from '../config/db.js'; // <-- Tambah .js
import bcrypt from 'bcryptjs';

// --- [PERBAIKAN] Ganti 'exports.' menjadi 'export const' ---
export const getAllUsers = async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT u.user_id, u.nama_lengkap, u.username, u.email, u.role_id, u.divisi_id, u.is_active, 
              r.nama_role, d.nama_divisi, d.kode_divisi
       FROM users u
       JOIN roles r ON u.role_id = r.role_id
       LEFT JOIN divisi d ON u.divisi_id = d.divisi_id
       ORDER BY u.nama_lengkap`
    );
    res.json(users);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

export const updateUser = async (req, res) => {
  const { id } = req.params;
  const { nama_lengkap, username, role_id, divisi_id, is_active, password } = req.body;

  try {
    // [FIX] Jika hanya update status (is_active), skip validasi field lain
    const isStatusToggleOnly = Object.keys(req.body).length === 1 && req.body.hasOwnProperty('is_active');
    
    if (isStatusToggleOnly) {
      // Hanya update status
      await pool.query(
        'UPDATE users SET is_active = ? WHERE user_id = ?',
        [is_active ? 1 : 0, id]
      );
      
      // Log aktivitas
      const adminId = req.user?.user_id;
      const ipAddress = req.ip || req.connection.remoteAddress || null;
      if (adminId) {
        const statusText = is_active ? 'mengaktifkan' : 'menonaktifkan';
        await logUserActivity(adminId, `Update status user: ${statusText} user ID ${id}`, ipAddress);
      }
      
      return res.json({ msg: 'Status user berhasil diupdate' });
    }

    // Validasi dasar untuk full update
    if (!nama_lengkap || !username || !role_id) {
      return res.status(400).json({ msg: 'Nama, Username, dan Role wajib diisi.' });
    }

    // Cek jika username duplikat (tapi bukan user ini sendiri)
    const [existing] = await pool.query(
      'SELECT user_id FROM users WHERE username = ? AND user_id != ?',
      [username, id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ msg: 'Username sudah dipakai user lain.' });
    }

    let query = `
      UPDATE users SET 
        nama_lengkap = ?, username = ?, role_id = ?, 
        divisi_id = ?, is_active = ? 
      WHERE user_id = ?`;
    
    const params = [nama_lengkap, username, role_id, divisi_id || null, is_active ? 1 : 0, id]; // Pastikan is_active 1 atau 0
    
    await pool.query(query, params);

    // Jika admin juga mengirim password baru, update passwordnya
    if (password && password.trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(password, salt);
      await pool.query(
        'UPDATE users SET password_hash = ? WHERE user_id = ?',
        [password_hash, id]
      );
    }
    
    // Log aktivitas
    const adminId = req.user?.user_id;
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    if (adminId) {
      await logUserActivity(adminId, `Update data user: ${username} (ID: ${id})`, ipAddress);
    }

    res.json({ msg: 'User berhasil diupdate' });

  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

export const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    // Jangan biarkan admin menghapus dirinya sendiri
    if (parseInt(id, 10) === req.user.user_id) {
        return res.status(400).json({ msg: 'Tidak bisa menghapus akun sendiri.' });
    }

    // [BARU] Cek apakah user yang akan dihapus adalah Admin
    const [userToDelete] = await pool.query(
      `SELECT u.user_id, u.nama_lengkap, r.nama_role
       FROM users u
       JOIN roles r ON u.role_id = r.role_id
       WHERE u.user_id = ?`,
      [id]
    );

    if (userToDelete.length === 0) {
      return res.status(404).json({ msg: 'User tidak ditemukan.' });
    }

    // Cek jika role adalah Admin
    if (userToDelete[0].nama_role.toLowerCase() === 'admin') {
      return res.status(400).json({ msg: 'User dengan role Admin tidak dapat dihapus.' });
    }

    const [result] = await pool.query('DELETE FROM users WHERE user_id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ msg: 'User tidak ditemukan' });
    }
    
    // Log aktivitas
    const adminId = req.user?.user_id;
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    if (adminId) {
      await logUserActivity(adminId, `Menghapus user: ${userToDelete[0].nama_lengkap} (ID: ${id})`, ipAddress);
    }

    res.json({ msg: 'User berhasil dihapus' });

  } catch (error)
 {
    // Error jika user sudah pernah ditugaskan opname
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.status(400).json({ msg: 'User tidak bisa dihapus karena memiliki riwayat opname.' });
    }
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

// [BARU] Get all user activity logs
export const getUserLogs = async (req, res) => {
  try {
    const [logs] = await pool.query(
      `SELECT l.*, u.nama_lengkap, u.username
       FROM user_logs l
       LEFT JOIN users u ON l.user_id = u.user_id
       ORDER BY l.waktu DESC
       LIMIT 500`
    );
    res.json(logs);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

// [BARU] Helper function to log user activity (dipakai di authController)
export const logUserActivity = async (userId, aktivitas, ipAddress = null) => {
  try {
    await pool.query(
      'INSERT INTO user_logs (user_id, aktivitas, ip_address, waktu) VALUES (?, ?, ?, NOW())',
      [userId, aktivitas, ipAddress]
    );
  } catch (error) {
    console.error('Error logging activity:', error.message);
  }
};

