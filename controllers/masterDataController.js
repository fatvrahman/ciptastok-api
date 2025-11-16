// path: api/controllers/masterDataController.js
import { pool } from '../config/db.js'; // <-- Tambah .js

// Helper function untuk mengambil semua data dari tabel
const getAll = (tableName) => async (req, res) => {
  try {
    const [results] = await pool.query(`SELECT * FROM ${tableName} ORDER BY 1`);
    res.json(results);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

// --- [PERBAIKAN] Ganti 'exports.' menjadi 'export const' ---
export const getAllDivisi = getAll('divisi');
export const getAllRak = getAll('rak');
export const getAllKategori = getAll('kategori');
export const getAllRoles = getAll('roles');

// Create Divisi
export const createDivisi = async (req, res) => {
  const { nama_divisi, kode_divisi } = req.body;

  if (!nama_divisi || !kode_divisi) {
    return res.status(400).json({ msg: 'Nama dan kode divisi wajib diisi.' });
  }

  try {
    // Check if exact combination already exists (kode + nama)
    const [existing] = await pool.query(
      'SELECT * FROM divisi WHERE kode_divisi = ? AND nama_divisi = ?',
      [kode_divisi, nama_divisi]
    );

    if (existing.length > 0) {
      return res.status(400).json({ msg: 'Kombinasi kode dan nama divisi sudah ada.' });
    }

    const [result] = await pool.query(
      'INSERT INTO divisi (nama_divisi, kode_divisi) VALUES (?, ?)',
      [nama_divisi, kode_divisi]
    );

    res.status(201).json({
      msg: 'Divisi berhasil ditambahkan',
      divisi_id: result.insertId
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

// Update Divisi
export const updateDivisi = async (req, res) => {
  const { id } = req.params;
  const { nama_divisi, kode_divisi } = req.body;

  if (!nama_divisi || !kode_divisi) {
    return res.status(400).json({ msg: 'Nama dan kode divisi wajib diisi.' });
  }

  try {
    // Check if exact combination already exists (excluding current divisi)
    const [existing] = await pool.query(
      'SELECT * FROM divisi WHERE kode_divisi = ? AND nama_divisi = ? AND divisi_id != ?',
      [kode_divisi, nama_divisi, id]
    );

    if (existing.length > 0) {
      return res.status(400).json({ msg: 'Kombinasi kode dan nama divisi sudah ada.' });
    }

    const [result] = await pool.query(
      'UPDATE divisi SET nama_divisi = ?, kode_divisi = ? WHERE divisi_id = ?',
      [nama_divisi, kode_divisi, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ msg: 'Divisi tidak ditemukan.' });
    }

    res.json({ msg: 'Divisi berhasil diupdate' });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

// Delete Divisi
export const deleteDivisi = async (req, res) => {
  const { id } = req.params;

  try {
    // Check if divisi is used by users
    const [users] = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE divisi_id = ?',
      [id]
    );

    if (users[0].count > 0) {
      return res.status(400).json({ 
        msg: `Divisi tidak dapat dihapus karena masih digunakan oleh ${users[0].count} user.` 
      });
    }

    const [result] = await pool.query(
      'DELETE FROM divisi WHERE divisi_id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ msg: 'Divisi tidak ditemukan.' });
    }

    res.json({ msg: 'Divisi berhasil dihapus' });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

// Migrate Users and Products from one divisi to another
export const migrateUsers = async (req, res) => {
  const { fromId, toId } = req.params;

  try {
    // Update users from old divisi_id to new divisi_id
    const [usersResult] = await pool.query(
      'UPDATE users SET divisi_id = ? WHERE divisi_id = ?',
      [toId, fromId]
    );

    // Update products from old divisi_id to new divisi_id
    const [productsResult] = await pool.query(
      'UPDATE produk SET divisi_id = ? WHERE divisi_id = ?',
      [toId, fromId]
    );

    res.json({ 
      msg: 'Users dan produk berhasil dimigrate',
      usersAffected: usersResult.affectedRows,
      productsAffected: productsResult.affectedRows
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};
