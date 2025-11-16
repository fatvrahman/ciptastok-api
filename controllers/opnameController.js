// path: api/controllers/opnameController.js
import { pool } from '../config/db.js';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit'; // <-- [FIX] Tambahin import PDF
import { logUserActivity } from './userController.js';

// Helper untuk mengambil tipe opname dari assignment_id
const getOpnameType = async (connection, assignment_id) => {
  const [assignment] = await connection.query(
    `SELECT b.tipe_opname 
     FROM opname_assignment a
     JOIN opname_batch b ON a.batch_id = b.batch_id
     WHERE a.assignment_id = ?`,
    [assignment_id]
  );
  if (assignment.length === 0) {
    throw new Error('Assignment tidak ditemukan.');
  }
  return assignment[0].tipe_opname;
};

// Helper internal untuk mengambil data detail assignment
const getAssignmentDetailsLogic = async (connection, assignment_id) => {
  const tipe_opname = await getOpnameType(connection, assignment_id);
  let results;
  
  if (tipe_opname === 'WH01') {
      const [details] = await connection.query(
        `SELECT d.*, r.nomor_rak AS rak, p.pcode as kode_produk, s.expired_date
         FROM opname_details_wh01 d
         LEFT JOIN produk p ON d.produk_id = p.produk_id
         LEFT JOIN stok_wh01 s ON d.produk_id = s.produk_id
         LEFT JOIN rak r ON s.rak_id = r.rak_id
         WHERE d.assignment_id = ? 
         ORDER BY d.nama_barang ASC`, // <-- [FIX] Ganti 'nama_barang'
        [assignment_id]
      );
      results = details.map(item => {
        const sysK = item.sistem_karton || 0;
        const sysT = item.sistem_tengah || 0;
        const sysP = item.sistem_pieces || 0;
        const fisK = item.fisik_karton; // Biarkan null jika memang null
        const fisT = item.fisik_tengah;
        const fisP = item.fisik_pieces;

        // PENTING: Tidak ada konversi karton->pcs di database
        // Jadi kita gunakan nilai langsung dari sistem_pieces dan fisik_pieces
        // Untuk tampilan, kita tetap tampilkan dalam format Karton-Tengah-Pieces
        const sistem_pcs = sysP;  // Langsung ambil pieces saja
        const fisik_pcs = fisP || 0;  // Langsung ambil pieces saja
        const selisih_pcs = fisik_pcs - sistem_pcs;

        let status_selisih = 'Sesuai';
        // Hanya cek selisih jika fisik sudah diisi (tidak null)
        if (fisK !== null || fisT !== null || fisP !== null) {
          // Cek apakah ada perbedaan di salah satu komponen
          if (
            (sysK !== (fisK || 0)) || 
            (sysT !== (fisT || 0)) || 
            (sysP !== (fisP || 0))
          ) {
            status_selisih = 'Selisih';
          }
        } else {
          status_selisih = null; // Belum diisi
        }

        // Untuk display, tampilkan total pieces (karton + tengah + pieces)
        // Asumsi: 1 karton = 1, 1 tengah = 1, 1 pieces = 1 (tidak ada konversi di database)
        // Karena tidak ada kolom konversi, kita tampilkan dalam format "K-T-P"
        const qty_system_display = `${sysK}-${sysT}-${sysP}`;
        const qty_fisik_display = `${fisK || 0}-${fisT || 0}-${fisP || 0}`;
        
        return {
          ...item,
          kode_produk: item.kode_produk || item.pcode,
          nama_produk: item.nama_barang,
          nomor_rak: item.rak,
          qty_system: qty_system_display,
          qty_fisik: qty_fisik_display,
          sistem_karton: sysK,
          sistem_tengah: sysT,
          sistem_pieces: sysP,
          fisik_karton: fisK,
          fisik_tengah: fisT,
          fisik_pieces: fisP,
          sistem_pcs,
          fisik_pcs,
          selisih_pcs,
          status_selisih: status_selisih
        };
      });
  } else if (tipe_opname === 'WH02') {
      const [details] = await connection.query(
        `SELECT * FROM opname_details_wh02 
         WHERE assignment_id = ? 
         ORDER BY nama_barang, nomor_koli ASC`,
        [assignment_id]
      );
      results = details;
  } else if (tipe_opname === 'WH03') {
      const [details] = await connection.query(
        `SELECT * FROM opname_details_wh03 
         WHERE assignment_id = ? 
         ORDER BY nama_barang, nomor_koli ASC`,
        [assignment_id]
      );
      results = details;
  } else {
    results = [];
  }
  return results;
};

// Helper internal untuk update stok WH01
const updateStokWH01FromDetails = async (connection, assignment_id) => {
  try {
    // Ambil semua detail yang sudah diisi
    const [details] = await connection.query(
      `SELECT * FROM opname_details_wh01 WHERE assignment_id = ? AND fisik_karton IS NOT NULL`,
      [assignment_id]
    );

    if (details.length === 0) return; // Tidak ada yang diupdate

    // Loop dan update satu per satu
    // Ini lebih aman daripada JOIN UPDATE jika ada logika kompleks
    for (const item of details) {
      await connection.query(
        `UPDATE stok_wh01 
         SET 
           sistem_karton = ?, 
           sistem_tengah = ?, 
           sistem_pieces = ?,
           expired_date = ?,
           rak_id = ?
         WHERE produk_id = ? AND stok_wh01_id = ?`, // Asumsi ada PK 'stok_wh01_id' di opname_details
        [
          item.fisik_karton,
          item.fisik_tengah,
          item.fisik_pieces,
          item.expired_date, // Ambil ExpDate baru dari hasil opname
          item.rak_id,       // Ambil Rak baru dari hasil opname
          item.produk_id,
          item.stok_wh01_id // Referensi ke stok asli
        ]
      );
    }
  } catch (error) {
    console.error('Gagal update stok WH01:', error);
    throw error; // Lemparkan error agar transaksi di-rollback
  }
};

// Helper internal untuk update stok WH02/WH03
const updateStokPcsFromDetails = async (connection, assignment_id, tipe) => {
  const detailTable = tipe === 'WH02' ? 'opname_details_wh02' : 'opname_details_wh03';
  const stokTable = tipe === 'WH02' ? 'stok_wh02' : 'stok_wh03';

  try {
    // 1. Hitung total fisik PCS per produk_id dari hasil opname
    const [totals] = await connection.query(
      `SELECT produk_id, SUM(fisik_pcs) as total_fisik
       FROM ${detailTable}
       WHERE assignment_id = ?
       GROUP BY produk_id`,
      [assignment_id]
    );

    if (totals.length === 0) return;

    // 2. Update tabel stok utama
    for (const item of totals) {
      await connection.query(
        `UPDATE ${stokTable}
         SET 
           sistem_total_pcs = ?
         WHERE produk_id = ?`,
        [item.total_fisik, item.produk_id]
      );
    }
    
    // 3. (Opsional) Hapus produk di stok utama jika total fisiknya 0?
    // Sesuai diskusi, kita hanya update.
    
  } catch (error) {
    console.error(`Gagal update stok ${stokTable}:`, error);
    throw error;
  }
};


// ===================================
// RUTE UNTUK ADMIN (Web Dashboard)
// ===================================

export const createOpnameBatch = async (req, res) => {
  const { nama_batch, tipe_opname, user_ids } = req.body;
  const created_by = req.user.user_id;

  if (!nama_batch || !tipe_opname || !user_ids || user_ids.length === 0) {
    return res.status(400).json({ msg: 'Semua field wajib diisi.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // [VALIDASI] Pastikan semua user yang ditugaskan memiliki divisi
    for (const user_id of user_ids) {
      const [userCheck] = await connection.query(
        'SELECT user_id, nama_lengkap, divisi_id FROM users WHERE user_id = ?', [user_id]
      );
      
      if (userCheck.length === 0) {
        await connection.rollback();
        return res.status(400).json({ msg: `User dengan ID ${user_id} tidak ditemukan.` });
      }
      
      if (!userCheck[0].divisi_id) {
        await connection.rollback();
        return res.status(400).json({ 
          msg: `User "${userCheck[0].nama_lengkap}" tidak memiliki divisi. Hanya user dengan divisi yang bisa ditugaskan opname.` 
        });
      }
    }

    // 1. Buat Batch Induk
    const [batchResult] = await connection.query(
      'INSERT INTO opname_batch (nama_batch, tipe_opname, created_by, status_overall) VALUES (?, ?, ?, ?)',
      [nama_batch, tipe_opname, created_by, 'In Progress']
    );
    const batch_id = batchResult.insertId;

    // 2. Buat Assignment untuk setiap user
    for (const user_id of user_ids) {
      // 2a. Ambil divisi user DULU (sudah pasti ada karena sudah divalidasi)
      const [userDivisi] = await connection.query(
        'SELECT divisi_id FROM users WHERE user_id = ?', [user_id]
      );
      const divisi_id = userDivisi[0].divisi_id;

      // 2b. Buat assignment DENGAN divisi_id
      const [assignResult] = await connection.query(
        'INSERT INTO opname_assignment (batch_id, user_id, divisi_id, status_assignment) VALUES (?, ?, ?, ?)',
        [batch_id, user_id, divisi_id, 'Pending']
      );
      const assignment_id = assignResult.insertId;

      // 3. Ambil Snapshot Stok (HANYA UNTUK WH01)
      if (tipe_opname === 'WH01') {
        // Ambil semua stok aktif WH01 untuk divisi user tersebut
        // dan salin ke opname_details_wh01
        const querySnapshot = `
          INSERT INTO opname_details_wh01 (
            assignment_id, 
            produk_id, 
            pcode, 
            nama_barang, 
            sistem_karton, 
            sistem_tengah, 
            sistem_pieces,
            sistem_exp_date
          )
          SELECT 
            ?, 
            p.produk_id, 
            p.pcode, 
            p.nama_barang, 
            s.sistem_karton, 
            s.sistem_tengah, 
            s.sistem_pieces,
            s.expired_date
          FROM stok_wh01 s
          JOIN produk p ON s.produk_id = p.produk_id
          WHERE p.divisi_id = ? AND s.is_active = 1
        `;
        await connection.query(querySnapshot, [assignment_id, divisi_id]);
      }
      // Untuk WH02 dan WH03, snapshot tidak diambil.
      // Data di-input manual per koli/produk oleh user di mobile app.
    }

    await connection.commit();
    
    // Log aktivitas
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    await logUserActivity(created_by, `Membuat batch opname: ${nama_batch}`, ipAddress);
    
    res.status(201).json({ msg: 'Batch opname berhasil dibuat.' });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error.message);
    res.status(500).send('Server Error');
  } finally {
    if (connection) connection.release();
  }
};

export const getAllBatches = async (req, res) => {
  try {
    // ==============================================================
    // [FIX "BATCH HANTU"]
    // Tambah DISTINCT dan JOIN ke assignment biar batch yg 
    // gak punya assignment (batch "IELTS" lu) gak muncul.
    // ==============================================================
    const [batches] = await pool.query(
      `SELECT DISTINCT b.*, u.nama_lengkap as pembuat
       FROM opname_batch b
       JOIN users u ON b.created_by = u.user_id
       JOIN opname_assignment a ON b.batch_id = a.batch_id
       ORDER BY b.created_at DESC`
    );
    res.json(batches);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

export const getAssignmentsByBatch = async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    // 1. Ambil Info Batch
    const [batchInfo] = await connection.query(
      `SELECT b.*, u.nama_lengkap as pembuat
       FROM opname_batch b
       JOIN users u ON b.created_by = u.user_id
       WHERE b.batch_id = ?`,
       [id]
    );
    
    if (batchInfo.length === 0) {
      return res.status(404).json({ msg: 'Batch tidak ditemukan.' });
    }

    // 2. Ambil Assignments
    // ==============================================================
    // [FIX "DATA KOSONG"]
    // Ganti JOIN users -> LEFT JOIN users
    // Biar kalo user-nya kehapus, datanya tetep muncul di riwayat
    // ==============================================================
    const [assignments] = await connection.query(
      `SELECT a.*, u.nama_lengkap as nama_user, d.nama_divisi, b.nama_batch
       FROM opname_assignment a
       LEFT JOIN users u ON a.user_id = u.user_id 
       LEFT JOIN divisi d ON u.divisi_id = d.divisi_id
       JOIN opname_batch b ON a.batch_id = b.batch_id
       WHERE a.batch_id = ?
       ORDER BY u.nama_lengkap`,
      [id]
    );

    res.json({
      batchInfo: batchInfo[0],
      assignments: assignments
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  } finally {
    if (connection) connection.release();
  }
};

export const getAssignmentDetailsForAdmin = async (req, res) => {
  const { assignment_id } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    
    // Get assignment info
    const [assignment] = await connection.query(
      `SELECT 
        oa.assignment_id,
        oa.status_assignment,
        oa.assigned_at,
        oa.submitted_at,
        oa.approved_at,
        u.nama_lengkap as nama_user,
        ob.nama_batch,
        ob.tipe_opname,
        d.nama_divisi,
        d.kode_divisi,
        CONCAT(d.kode_divisi, ' - ', d.nama_divisi) as divisi_lengkap,
        ob.tipe_opname as nama_gudang
       FROM opname_assignment oa
       JOIN users u ON oa.user_id = u.user_id
       JOIN opname_batch ob ON oa.batch_id = ob.batch_id
       LEFT JOIN divisi d ON u.divisi_id = d.divisi_id
       WHERE oa.assignment_id = ?`,
      [assignment_id]
    );
    
    if (assignment.length === 0) {
      return res.status(404).json({ msg: 'Assignment tidak ditemukan' });
    }
    
    // Get details
    const details = await getAssignmentDetailsLogic(connection, assignment_id);
    
    res.json({
      assignment: assignment[0],
      details: details
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ msg: 'Server Error', error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

export const approveOrRejectAssignment = async (req, res) => {
  const { assignment_id } = req.params;
  const { status } = req.body; // 'Approved' or 'Rejected'
  const admin_id = req.user.user_id;

  if (status !== 'Approved' && status !== 'Rejected') {
    return res.status(400).json({ msg: 'Status tidak valid.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Cek status saat ini
    const [current] = await connection.query(
      'SELECT status_assignment, batch_id FROM opname_assignment WHERE assignment_id = ?',
      [assignment_id]
    );

    if (current.length === 0) {
      throw new Error('Assignment tidak ditemukan.');
    }
    if (current[0].status_assignment !== 'Submitted') {
      return res.status(400).json({ msg: `Tugas ini sudah ${current[0].status_assignment}, tidak bisa diubah.` });
    }
    
    const batch_id = current[0].batch_id;

    // 2. Update status assignment
    await connection.query(
      `UPDATE opname_assignment 
       SET status_assignment = ?, approved_by = ?, approved_at = NOW() 
       WHERE assignment_id = ?`,
      [status, admin_id, assignment_id]
    );

    // 3. JIKA 'APPROVED', update stok utama
    if (status === 'Approved') {
      const tipe_opname = await getOpnameType(connection, assignment_id);
      
      if (tipe_opname === 'WH01') {
        await updateStokWH01FromDetails(connection, assignment_id);
      } else {
        // WH02 atau WH03
        await updateStokPcsFromDetails(connection, assignment_id, tipe_opname);
      }
    }

    // 4. Cek apakah semua assignment di batch ini sudah selesai
    await checkBatchCompletion(connection, batch_id);

    await connection.commit();
    
    // Log aktivitas
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    const action = status === 'Approved' ? 'Menyetujui' : 'Menolak';
    await logUserActivity(admin_id, `${action} hasil opname (Assignment ID: ${assignment_id})`, ipAddress);
    
    res.json({ msg: `Tugas berhasil di-${status}.` });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error.message);
    res.status(500).send('Server Error');
  } finally {
    if (connection) connection.release();
  }
};

// [BARU] Delete Assignment - hanya boleh jika status masih Pending atau In Progress
export const deleteAssignment = async (req, res) => {
  const { assignment_id } = req.params;
  
  let connection;
  let retries = 3;
  
  while (retries > 0) {
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      
      // Cek status assignment dengan lock
      const [rows] = await connection.query(
        'SELECT status_assignment, batch_id FROM opname_assignment WHERE assignment_id = ? FOR UPDATE',
        [assignment_id]
      );
      
      if (!rows || rows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ msg: 'Assignment tidak ditemukan.' });
      }
      
      const assignment = rows[0];
      
      // Hanya boleh delete jika status Pending atau In Progress (belum submit)
      if (assignment.status_assignment === 'Submitted' || 
          assignment.status_assignment === 'Approved' || 
          assignment.status_assignment === 'Rejected') {
        await connection.rollback();
        return res.status(400).json({ 
          msg: `Assignment dengan status ${assignment.status_assignment} tidak dapat dihapus.` 
        });
      }
      
      const batch_id = assignment.batch_id;
      
      // Delete assignment details first (manual cascade if needed)
      await connection.query(
        'DELETE FROM opname_details_wh01 WHERE assignment_id = ?',
        [assignment_id]
      );
      
      await connection.query(
        'DELETE FROM opname_details_wh02 WHERE assignment_id = ?',
        [assignment_id]
      );
      
      await connection.query(
        'DELETE FROM opname_details_wh03 WHERE assignment_id = ?',
        [assignment_id]
      );
      
      // Delete assignment
      await connection.query(
        'DELETE FROM opname_assignment WHERE assignment_id = ?', 
        [assignment_id]
      );
      
      // Cek apakah masih ada assignment lain di batch yang sama
      const [remainingRows] = await connection.query(
        'SELECT COUNT(*) as count FROM opname_assignment WHERE batch_id = ?',
        [batch_id]
      );
      
      // Jika tidak ada assignment lagi, update batch status kembali ke Draft
      if (remainingRows[0].count === 0) {
        await connection.query(
          'UPDATE opname_batch SET status_overall = ? WHERE batch_id = ?',
          ['Draft', batch_id]
        );
      }
      
      await connection.commit();
      
      res.json({ msg: 'Assignment berhasil dihapus.' });
      break; // Success, exit retry loop
      
    } catch (error) {
      if (connection) await connection.rollback();
      
      // Check if it's a deadlock error
      if (error.code === 'ER_LOCK_DEADLOCK' && retries > 1) {
        retries--;
        console.log(`Deadlock detected, retrying... (${3 - retries}/3)`);
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 100 * (4 - retries)));
        continue;
      }
      
      // If not a deadlock or out of retries, return error
      console.error('Error deleting assignment:', error);
      return res.status(500).json({ 
        msg: error.code === 'ER_LOCK_DEADLOCK' 
          ? 'Terjadi konflik saat menghapus assignment. Silakan coba lagi.' 
          : 'Server Error', 
        error: error.message 
      });
    } finally {
      if (connection) connection.release();
    }
  }
};

export const getAllActiveAssignments = async (req, res) => {
  try {
    const [assignments] = await pool.query(
      `SELECT 
         a.*, 
         u.nama_lengkap as nama_user, 
         d.nama_divisi, 
         d.kode_divisi,
         CONCAT(d.kode_divisi, ' - ', d.nama_divisi) as divisi_lengkap,
         b.nama_batch, 
         b.tipe_opname,
         b.created_at,
         creator.nama_lengkap as pembuat
       FROM opname_assignment a
       JOIN users u ON a.user_id = u.user_id
       LEFT JOIN divisi d ON u.divisi_id = d.divisi_id
       JOIN opname_batch b ON a.batch_id = b.batch_id
       LEFT JOIN users creator ON b.created_by = creator.user_id
       WHERE b.status_overall = 'In Progress'
       ORDER BY b.created_at DESC, u.nama_lengkap`
    );
    res.json(assignments);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

export const getSingleAssignmentInfo = async (req, res) => {
  const { assignment_id } = req.params;
  console.log('🔍 [DEBUG] getSingleAssignmentInfo called with assignment_id:', assignment_id);
  
  try {
    const [info] = await pool.query(
      `SELECT a.assignment_id, a.status_assignment, a.submitted_at, a.approved_at,
              u.nama_lengkap as nama_user, 
              d.nama_divisi, 
              d.kode_divisi,
              CONCAT(d.kode_divisi, ' - ', d.nama_divisi) as divisi_lengkap,
              b.nama_batch, b.tipe_opname
       FROM opname_assignment a
       LEFT JOIN users u ON a.user_id = u.user_id
       LEFT JOIN divisi d ON u.divisi_id = d.divisi_id
       JOIN opname_batch b ON a.batch_id = b.batch_id
       WHERE a.assignment_id = ?`,
      [assignment_id]
    );
    
    console.log('🔍 [DEBUG] Query result:', info.length > 0 ? info[0] : 'No results found');
    
    if (info.length === 0) {
      return res.status(404).json({ msg: 'Info assignment tidak ditemukan.' });
    }
    res.json(info[0]);
  } catch (error) {
    console.error('❌ [ERROR] getSingleAssignmentInfo:', error.message);
    res.status(500).send('Server Error');
  }
};

// Helper untuk cek penyelesaian batch
const checkBatchCompletion = async (connection, batch_id) => {
  try {
    const [result] = await connection.query(
      `SELECT 
         COUNT(*) as total, 
         SUM(CASE WHEN status_assignment IN ('Approved', 'Rejected') THEN 1 ELSE 0 END) as completed
       FROM opname_assignment 
       WHERE batch_id = ?`,
      [batch_id]
    );

    if (result.length > 0) {
      const stats = result[0];
      // ==============================================================
      // [FIX "GAGAL COMPLETED"]
      // Ganti === jadi Number() === Number()
      // Biar '1' (string) tetep sama dengan 1 (angka)
      // ==============================================================
      if (Number(stats.total) === Number(stats.completed)) {
        await connection.query(
          `UPDATE opname_batch SET status_overall = 'Completed', completed_at = NOW() WHERE batch_id = ?`,
          [batch_id]
        );
      }
    }
  } catch (error) {
    console.error('Gagal cek status batch:', error);
    throw error; // Wajib di-throw agar transaksi di-rollback
  }
};

// ===============================================
// --- [LAMA] DOWNLOAD LAPORAN SEBAGAI EXCEL ---
// ===============================================
export const downloadLaporanExcel = async (req, res) => {
  const { batch_id } = req.params;

  let connection;
  try {
    connection = await pool.getConnection();

    // 1. Ambil Info Batch Utama
    const [batch] = await connection.query(
      `SELECT b.*, u.nama_lengkap as pembuat
       FROM opname_batch b
       JOIN users u ON b.created_by = u.user_id
       WHERE b.batch_id = ? AND b.status_overall = 'Completed'`,
      [batch_id]
    );

    if (batch.length === 0) {
      return res.status(404).json({ msg: 'Batch opname tidak ditemukan atau belum selesai.' });
    }
    const batchInfo = batch[0];
    const tipeOpname = batchInfo.tipe_opname;

    // 2. Ambil semua assignment di batch tsb
    const [assignments] = await connection.query(
      `SELECT a.*, u.nama_lengkap as nama_user, d.nama_divisi
       FROM opname_assignment a
       LEFT JOIN users u ON a.user_id = u.user_id
       LEFT JOIN divisi d ON u.divisi_id = d.divisi_id
       WHERE a.batch_id = ?
       ORDER BY u.nama_lengkap`,
      [batch_id]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ msg: 'Tidak ada penugasan di batch ini.' });
    }

    // 3. Buat Workbook Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Ciptastok Admin';
    workbook.created = new Date();

    // 4. Buat Halaman Judul (Summary)
    const summarySheet = workbook.addWorksheet('Ringkasan Batch');
    summarySheet.addRow(['Laporan Riwayat Opname']).font = { size: 16, bold: true };
    summarySheet.addRow([]);
    summarySheet.addRow(['Nama Batch', batchInfo.nama_batch]);
    summarySheet.addRow(['Tipe Opname', batchInfo.tipe_opname]);
    summarySheet.addRow(['Dibuat Oleh', batchInfo.pembuat]);
    summarySheet.addRow(['Tanggal Selesai', new Date(batchInfo.completed_at).toLocaleString('id-ID')]);
    summarySheet.addRow([]);
    summarySheet.addRow(['Daftar Penugasan']).font = { size: 14, bold: true };
    summarySheet.addRow(['Nama User', 'Divisi', 'Status', 'Waktu Submit', 'Di-approve Oleh']);
    
    // Ambil daftar admin (untuk mapping ID ke Nama)
    const [admins] = await connection.query('SELECT user_id, nama_lengkap FROM users');
    const adminMap = new Map(admins.map(admin => [admin.user_id, admin.nama_lengkap]));

    assignments.forEach(assign => {
      summarySheet.addRow([
        assign.nama_user || '(User Dihapus)',
        assign.nama_divisi || '-',
        assign.status_assignment,
        assign.submitted_at ? new Date(assign.submitted_at).toLocaleString('id-ID') : '-',
        adminMap.get(assign.approved_by) || '-'
      ]);
    });
    summarySheet.columns.forEach(column => { column.width = 25; });

    // 5. Buat Sheet Detail untuk setiap assignment
    for (const assign of assignments) {
      const userName = (assign.nama_user || `User_${assign.user_id}`).replace(/[\*\[\]\:\/\?\\]/g, ''); // Sanitasi nama sheet
      const detailSheet = workbook.addWorksheet(`Detail - ${userName.substring(0, 20)}`);
      
      let query;
      if (tipeOpname === 'WH01') {
        // ==============================================================
        // [FIX "rak"]
        // Ganti 'rak' -> 'rak_id'
        // ==============================================================
        query = `
          SELECT d.*, r.nomor_rak, s.expired_date 
          FROM opname_details_wh01 d 
          LEFT JOIN stok_wh01 s ON d.produk_id = s.produk_id
          LEFT JOIN rak r ON s.rak_id = r.rak_id
          WHERE d.assignment_id = ? 
          ORDER BY d.nama_barang, r.nomor_rak
        `;
        
        const [details] = await connection.query(query, [assign.assignment_id]);
        
        // Header WH01
        detailSheet.addRow([
          'PCode', 'Nama Barang', 'Rak', 'Expired', 
          'Sistem (K)', 'Sistem (T)', 'Sistem (P)',
          'Fisik (K)', 'Fisik (T)', 'Fisik (P)',
          'Status Selisih'
        ]);
        
        // Data WH01
        details.forEach(item => {
          const { status_selisih } = getAssignmentDetailsLogic(null, null, [item], 'WH01')[0]; // Ambil status selisih
          detailSheet.addRow([
            item.pcode, item.nama_barang, item.nama_rak || '-', 
            item.expired_date ? new Date(item.expired_date).toLocaleDateString('id-ID') : '-',
            item.sistem_karton, item.sistem_tengah, item.sistem_pieces,
            item.fisik_karton, item.fisik_tengah, item.fisik_pieces,
            status_selisih
          ]);
        });
        
      } else {
        // WH02 atau WH03
        const detailTable = tipeOpname === 'WH02' ? 'opname_details_wh02' : 'opname_details_wh03';
        query = `SELECT * FROM ${detailTable} WHERE assignment_id = ? ORDER BY nama_barang, nomor_koli`;
        
        const [details] = await connection.query(query, [assign.assignment_id]);

        // Header WH02/03
        detailSheet.addRow(['PCode', 'Nama Barang', 'Nomor Koli', 'Fisik (PCS)']);
        
        // Data WH02/03
        details.forEach(item => {
          detailSheet.addRow([
            item.pcode, item.nama_barang, item.nomor_koli, item.fisik_pcs
          ]);
        });
      }
      detailSheet.columns.forEach(column => { column.width = 20; });
    }
    
    // 6. Kirim file
    const fileName = `Ciptastok_Laporan_${batchInfo.nama_batch.replace(/[\W_]+/g,"-")}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  } finally {
    if (connection) connection.release();
  }
};


// ===============================================
// --- [BARU] DOWNLOAD LAPORAN SEBAGAI PDF ---
// ===============================================
export const downloadLaporanPdf = async (req, res) => {
  const { batch_id } = req.params;

  let connection;
  try {
    connection = await pool.getConnection();

    // 1. Ambil Info Batch Utama
    const [batch] = await connection.query(
      `SELECT b.*, u.nama_lengkap as pembuat
       FROM opname_batch b
       JOIN users u ON b.created_by = u.user_id
       WHERE b.batch_id = ? AND b.status_overall = 'Completed'`,
      [batch_id]
    );

    if (batch.length === 0) {
      return res.status(404).json({ msg: 'Batch opname tidak ditemukan atau belum selesai.' });
    }
    const batchInfo = batch[0];
    const tipeOpname = batchInfo.tipe_opname;

    // 2. Ambil semua assignment di batch tsb
    const [assignments] = await connection.query(
      `SELECT a.*, u.nama_lengkap as nama_user, d.nama_divisi
       FROM opname_assignment a
       LEFT JOIN users u ON a.user_id = u.user_id
       LEFT JOIN divisi d ON u.divisi_id = d.divisi_id
       WHERE a.batch_id = ?
       ORDER BY u.nama_lengkap`,
      [batch_id]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ msg: 'Tidak ada penugasan di batch ini.' });
    }

    // 3. Ambil SEMUA detail dari SEMUA assignment
    const allDetails = {};
    const detailTable = tipeOpname === 'WH01' ? 'opname_details_wh01' : (tipeOpname === 'WH02' ? 'opname_details_wh02' : 'opname_details_wh03');
    
    for (const assign of assignments) {
      let query;
      if (tipeOpname === 'WH01') {
        // ==============================================================
        // [FIX "rak"]
        // Ganti 'rak' -> 'rak_id'
        // ==============================================================
        query = `
          SELECT d.*, r.nomor_rak, s.expired_date 
          FROM ${detailTable} d
          LEFT JOIN stok_wh01 s ON d.produk_id = s.produk_id
          LEFT JOIN rak r ON s.rak_id = r.rak_id
          WHERE d.assignment_id = ? 
          ORDER BY d.nama_barang, r.nomor_rak`;
      } else {
        query = `SELECT * FROM ${detailTable} WHERE assignment_id = ? ORDER BY nama_barang, nomor_koli`;
      }
      
      const [details] = await connection.query(query, [assign.assignment_id]);
      // [FIX] Proses detail WH01 untuk dapet status_selisih
      if (tipeOpname === 'WH01') {
         allDetails[assign.assignment_id] = details.map(item => {
            const { status_selisih } = getAssignmentDetailsLogic(null, null, [item], 'WH01')[0];
            return { ...item, status_selisih };
         });
      } else {
         allDetails[assign.assignment_id] = details;
      }
    }
    
    // 4. Bangun PDF
    const fileName = `Ciptastok_Laporan_${batchInfo.nama_batch.replace(/[\W_]+/g,"-")}.pdf`;
    buildPdf(res, batchInfo, assignments, allDetails, fileName);

  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  } finally {
    if (connection) connection.release();
  }
};


// ==========================================================
// --- [BARU] FUNGSI HELPER UNTUK GENERATE PDF ---
// ==========================================================

// Helper utama untuk PDF
const buildPdf = (res, batchInfo, assignments, allDetails, fileName) => {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  doc.pipe(res);

  // --- Halaman Judul ---
  doc.fontSize(20).font('Helvetica-Bold').text(`Laporan Riwayat Opname`, { align: 'center' });
  doc.moveDown(1.5);

  doc.fontSize(14).font('Helvetica-Bold').text(batchInfo.nama_batch);
  doc.fontSize(12).font('Helvetica').text(`Tipe Opname: ${batchInfo.tipe_opname}`);
  doc.fontSize(12).font('Helvetica').text(`Tanggal Selesai: ${new Date(batchInfo.completed_at).toLocaleString('id-ID')}`);
  doc.fontSize(12).font('Helvetica').text(`Dibuat Oleh: ${batchInfo.pembuat}`);
  
  doc.moveDown(2);
  
  // --- Ringkasan Penugasan ---
  doc.fontSize(16).font('Helvetica-Bold').text('Ringkasan Penugasan');
  doc.moveDown(0.5);

  // Header Tabel Ringkasan
  const summaryTableTop = doc.y;
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text('User', 50, summaryTableTop);
  doc.text('Divisi', 200, summaryTableTop);
  doc.text('Status', 350, summaryTableTop);
  doc.text('Waktu Submit', 450, summaryTableTop);
  doc.moveDown(0.5);
  
  // Garis Header
  doc.strokeColor('#aaaaaa')
     .lineWidth(0.5)
     .moveTo(50, doc.y)
     .lineTo(550, doc.y)
     .stroke();
  doc.moveDown(0.5);

  // Isi Tabel Ringkasan
  doc.font('Helvetica').fontSize(10);
  assignments.forEach(assign => {
    const y = doc.y;
    doc.text(assign.nama_user || '(User Dihapus)', 50, y, { width: 140 });
    doc.text(assign.nama_divisi || '-', 200, y, { width: 140 });
    doc.text(assign.status_assignment, 350, y, { width: 90 });
    doc.text(assign.submitted_at ? new Date(assign.submitted_at).toLocaleString('id-ID') : '-', 450, y, { width: 100 });
    doc.moveDown(1.5);
  });

  // --- Detail per Assignment ---
  assignments.forEach(assign => {
    const details = allDetails[assign.assignment_id];
    if (!details || details.length === 0) return;

    doc.addPage(); // Halaman baru untuk tiap user
    doc.fontSize(16).font('Helvetica-Bold').text(`Rincian: ${assign.nama_user || '(User Dihapus)'} (${assign.nama_divisi || '-'})`);
    doc.fontSize(10).font('Helvetica').text(`Status: ${assign.status_assignment}`);
    doc.moveDown(1);
    
    // Generate tabel berdasarkan Tipe Opname
    if (batchInfo.tipe_opname === 'WH01') {
      generatePdfTableWH01(doc, details);
    } else {
      generatePdfTablePcs(doc, details, batchInfo.tipe_opname);
    }
  });

  doc.end();
};

// Helper buat tabel PDF WH01
const generatePdfTableWH01 = (doc, details) => {
  const tableTop = doc.y;
  const headers = ['PCode', 'Nama Barang', 'Rak', 'Expired', 'Status', 'Sys(K)', 'Fis(K)', 'Sys(T)', 'Fis(T)', 'Sys(P)', 'Fis(P)'];
  const colWidths = [60, 100, 30, 50, 40, 30, 30, 30, 30, 30, 30];
  let x = 40;

  doc.font('Helvetica-Bold').fontSize(8);
  headers.forEach((header, i) => {
    doc.text(header, x, tableTop, { width: colWidths[i], align: 'left' });
    x += colWidths[i] + 5;
  });
  doc.moveDown(0.5);
  
  const headerY = doc.y;
  doc.strokeColor('#aaaaaa').lineWidth(0.5).moveTo(40, headerY).lineTo(560, headerY).stroke();
  doc.moveDown(0.5);

  doc.font('Helvetica').fontSize(8);
  details.forEach(item => {
    const y = doc.y;
    if (y > 750) { // Cek batas halaman
      doc.addPage();
      doc.y = 40; // Reset Y
    }
    
    const row = [
      item.pcode,
      item.nama_barang,
      item.nama_rak || '-', // <-- [FIX] Pake nama_rak
      item.expired_date ? new Date(item.expired_date).toLocaleDateString('id-ID') : '-',
      item.status_selisih,
      item.sistem_karton, item.fisik_karton,
      item.sistem_tengah, item.fisik_tengah,
      item.sistem_pieces, item.fisik_pieces
    ];
    
    x = 40;
    row.forEach((cell, i) => {
      // Ubah warna font jika selisih
      if (item.status_selisih === 'Selisih' && i > 4) {
          doc.fillColor('red');
      } else {
          doc.fillColor('black');
      }
      doc.text(cell, x, doc.y, { width: colWidths[i], align: 'left' });
      x += colWidths[i] + 5;
    });
    doc.fillColor('black'); // Reset warna
    doc.moveDown(1.5);
  });
};

// Helper buat tabel PDF WH02/WH03
const generatePdfTablePcs = (doc, details, tipe) => {
  const tableTop = doc.y;
  const headers = ['PCode', 'Nama Barang', 'No. Koli', 'Fisik (PCS)'];
  const colWidths = [100, 250, 80, 80];
  let x = 40;

  doc.font('Helvetica-Bold').fontSize(9);
  headers.forEach((header, i) => {
    doc.text(header, x, tableTop, { width: colWidths[i], align: i > 2 ? 'right' : 'left' });
    x += colWidths[i] + 10;
  });
  doc.moveDown(0.5);

  const headerY = doc.y;
  doc.strokeColor('#aaaaaa').lineWidth(0.5).moveTo(40, headerY).lineTo(560, headerY).stroke();
  doc.moveDown(0.5);

  doc.font('Helvetica').fontSize(9);
  details.forEach(item => {
    const y = doc.y;
    if (y > 750) { // Cek batas halaman
      doc.addPage();
      doc.y = 40; // Reset Y
    }
    
    const row = [ item.pcode, item.nama_barang, item.nomor_koli, item.fisik_pcs ];
    x = 40;
    row.forEach((cell, i) => {
      doc.text(cell, x, doc.y, { width: colWidths[i], align: i > 2 ? 'right' : 'left' });
      x += colWidths[i] + 10;
    });
    doc.moveDown(1.5);
  });
};


// ===================================
// RUTE UNTUK USER (Mobile App)
// ===================================

export const getMyActiveTask = async (req, res) => {
  const user_id = req.user.user_id;

  try {
    const [task] = await pool.query(
      `SELECT a.assignment_id, b.nama_batch, b.tipe_opname
       FROM opname_assignment a
       JOIN opname_batch b ON a.batch_id = b.batch_id
       WHERE a.user_id = ? AND a.status_assignment IN ('Pending', 'In Progress')
       LIMIT 1`,
      [user_id]
    );

    if (task.length === 0) {
      return res.status(404).json({ msg: 'Tidak ada tugas opname aktif.' });
    }

    // [BARU] Otomatis set 'In Progress' saat user pertama kali buka tugas
    if (task[0].status_assignment === 'Pending') {
      await pool.query(
        "UPDATE opname_assignment SET status_assignment = 'In Progress', started_at = NOW() WHERE assignment_id = ?",
        [task[0].assignment_id]
      );
    }

    res.json(task[0]);

  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

export const submitOpname = async (req, res) => {
  const { assignment_id } = req.params;
  const user_id = req.user.user_id;

  let connection;
  try {
    connection = await pool.getConnection();

    // 1. Validasi kepemilikan
    const [owner] = await connection.query(
      'SELECT user_id, status_assignment FROM opname_assignment WHERE assignment_id = ?',
      [assignment_id]
    );
    if (owner.length === 0 || owner[0].user_id !== user_id) {
      return res.status(403).json({ msg: 'Akses ditolak.' });
    }
    if (owner[0].status_assignment !== 'In Progress') {
      return res.status(400).json({ msg: 'Tugas ini tidak bisa di-submit (mungkin sudah selesai atau belum dimulai).' });
    }

    // 2. [KHUSUS WH01] Cek apakah semua item sudah diisi
    const tipe_opname = await getOpnameType(connection, assignment_id);
    if (tipe_opname === 'WH01') {
      const [check] = await connection.query(
        `SELECT COUNT(*) as total, SUM(CASE WHEN fisik_karton IS NOT NULL THEN 1 ELSE 0 END) as terisi
         FROM opname_details_wh01
         WHERE assignment_id = ?`,
        [assignment_id]
      );
      
      if (check.length === 0 || check[0].total > check[0].terisi) {
         return res.status(400).json({ msg: 'Data opname WH01 belum lengkap. Pastikan semua produk sudah diisi.' });
      }
    }
    // Untuk WH02/WH03, user bisa submit walau kosong (mungkin memang tidak ada barang)

    // 3. Update status
    await connection.query(
      "UPDATE opname_assignment SET status_assignment = 'Submitted', submitted_at = NOW() WHERE assignment_id = ?",
      [assignment_id]
    );
    
    // Log aktivitas
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    await logUserActivity(user_id, `Submit hasil opname (Assignment ID: ${assignment_id})`, ipAddress);
    
    res.json({ msg: 'Opname berhasil di-submit dan akan diverifikasi oleh Admin.' });

  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  } finally {
    if (connection) connection.release();
  }
};

// --- WH01 (Barang Baik) ---
export const getOpnameDetailsWH01 = async (req, res) => {
  const { assignment_id } = req.params;
  const user_id = req.user.user_id;
  try {
    // Validasi
    const [owner] = await pool.query('SELECT user_id FROM opname_assignment WHERE assignment_id = ?', [assignment_id]);
    if (owner.length === 0 || owner[0].user_id !== user_id) {
      return res.status(403).json({ msg: 'Akses ditolak.' });
    }
    
    const [details] = await pool.query(
      `SELECT d.*, r.nomor_rak AS rak, s.expired_date
       FROM opname_details_wh01 d
       LEFT JOIN stok_wh01 s ON d.produk_id = s.produk_id
       LEFT JOIN rak r ON s.rak_id = r.rak_id
       WHERE d.assignment_id = ?
       ORDER BY d.nama_barang`,
      [assignment_id]
    );
    res.json(details);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

export const updateOpnameDetailWH01 = async (req, res) => {
  const { detail_id } = req.params;
  const user_id = req.user.user_id;
  const { fisik_karton, fisik_tengah, fisik_pieces, expired_date } = req.body;

  // Validasi input
  const fk = fisik_karton === '' || fisik_karton === null ? null : parseInt(fisik_karton);
  const ft = fisik_tengah === '' || fisik_tengah === null ? null : parseInt(fisik_tengah);
  const fp = fisik_pieces === '' || fisik_pieces === null ? null : parseInt(fisik_pieces);
  const exp = expired_date || null;
  
  // Salah satu harus diisi
   if (fk === null && ft === null && fp === null) {
     return res.status(400).json({ msg: 'Minimal isi salah satu jumlah fisik.' });
   }

  try {
    // Validasi kepemilikan
    const [check] = await pool.query(
      `SELECT a.user_id FROM opname_details_wh01 d 
       JOIN opname_assignment a ON d.assignment_id = a.assignment_id
       WHERE d.detail_id = ?`,
      [detail_id]
    );
    if (check.length === 0 || check[0].user_id !== user_id) {
      return res.status(403).json({ msg: 'Akses ditolak.' });
    }
    
    await pool.query(
      `UPDATE opname_details_wh01 
       SET 
         fisik_karton = ?, 
         fisik_tengah = ?, 
         fisik_pieces = ?, 
         expired_date = ?,
         opname_at = CURRENT_TIMESTAMP
       WHERE detail_id = ?`,
      [fk, ft, fp, exp, detail_id]
    );
    
    res.json({ msg: 'Data fisik berhasil disimpan.' });
    
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};


// --- WH02 (Barang BS) ---
export const getProductsForWH02Task = async (req, res) => {
  const { assignment_id } = req.params;
  const user_id = req.user.user_id;
  try {
    // 1. Validasi
    const [owner] = await pool.query(
      'SELECT a.user_id, u.divisi_id FROM opname_assignment a JOIN users u ON a.user_id = u.user_id WHERE assignment_id = ?', 
      [assignment_id]
    );
    if (owner.length === 0 || owner[0].user_id !== user_id) {
      return res.status(403).json({ msg: 'Akses ditolak.' });
    }
    const divisi_id = owner[0].divisi_id;
    
    // 2. Ambil daftar produk WH02 (BS) yang aktif dan sesuai divisi user
    const [products] = await pool.query(
      `SELECT p.produk_id, p.pcode, p.nama_barang
       FROM stok_wh02 s
       JOIN produk p ON s.produk_id = p.produk_id
       WHERE s.is_active = 1 AND p.divisi_id = ?
       ORDER BY p.nama_barang`,
       [divisi_id]
    );
    res.json(products);
  } catch (error) {
     console.error(error.message);
     res.status(500).send('Server Error');
  }
};

export const getKoliDetailsWH02 = async (req, res) => {
  const { assignment_id, produk_id } = req.params;
  const user_id = req.user.user_id;
  try {
    // Validasi
    const [owner] = await pool.query('SELECT user_id FROM opname_assignment WHERE assignment_id = ?', [assignment_id]);
     if (owner.length === 0 || owner[0].user_id !== user_id) {
      return res.status(403).json({ msg: 'Akses ditolak.' });
    }
    
    const [details] = await pool.query(
      `SELECT * FROM opname_details_wh02
       WHERE assignment_id = ? AND produk_id = ?
       ORDER BY opname_at DESC`,
      [assignment_id, produk_id]
    );
    res.json(details);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

export const addOrUpdateKoliDetailWH02 = async (req, res) => {
  const { assignment_id, produk_id, nomor_koli, fisik_pcs } = req.body;
  const user_id = req.user.user_id;

  if (!assignment_id || !produk_id || !nomor_koli || !fisik_pcs) {
    return res.status(400).json({ msg: 'Semua field wajib diisi.' });
  }

  try {
    // Validasi kepemilikan
    const [owner] = await pool.query('SELECT user_id FROM opname_assignment WHERE assignment_id = ?', [assignment_id]);
    if (owner.length === 0 || owner[0].user_id !== user_id) {
      return res.status(403).json({ msg: 'Akses ditolak.' });
    }

    // Ambil nama barang (untuk efisiensi, agar tidak query lagi)
    const [prod] = await pool.query('SELECT nama_barang FROM produk WHERE produk_id = ?', [produk_id]);
    if (prod.length === 0) return res.status(404).json({ msg: 'Produk tidak ditemukan.' });

    // Gunakan ON DUPLICATE KEY UPDATE untuk handle 'nomor_koli' yang unik
    await pool.query(
      `INSERT INTO opname_details_wh02 (assignment_id, produk_id, nama_barang, nomor_koli, fisik_pcs)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         fisik_pcs = VALUES(fisik_pcs),
         opname_at = CURRENT_TIMESTAMP`,
      [assignment_id, produk_id, prod[0].nama_barang, nomor_koli, fisik_pcs]
    );

    res.status(201).json({ msg: `Koli ${nomor_koli} berhasil disimpan.` });

  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

export const deleteKoliDetailWH02 = async (req, res) => {
  const { detail_id } = req.params;
  const user_id = req.user.user_id;

  try {
    // Validasi kepemilikan
    const [check] = await pool.query(
      `SELECT a.user_id FROM opname_details_wh02 d 
       JOIN opname_assignment a ON d.assignment_id = a.assignment_id
       WHERE d.detail_id = ?`,
      [detail_id]
    );
    if (check.length === 0 || check[0].user_id !== user_id) {
      return res.status(403).json({ msg: 'Akses ditolak.' });
    }
    
    await pool.query('DELETE FROM opname_details_wh02 WHERE detail_id = ?', [detail_id]);
    res.json({ msg: 'Data koli berhasil dihapus.' });

  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

// --- WH03 (Barang Promo) ---
// (Logika WH03 99% sama dengan WH02, hanya beda tabel)
export const getProductsForWH03Task = async (req, res) => {
  const { assignment_id } = req.params;
  const user_id = req.user.user_id;
  try {
    const [owner] = await pool.query(
      'SELECT a.user_id, u.divisi_id FROM opname_assignment a JOIN users u ON a.user_id = u.user_id WHERE assignment_id = ?', 
      [assignment_id]
    );
    if (owner.length === 0 || owner[0].user_id !== user_id) {
      return res.status(403).json({ msg: 'Akses ditolak.' });
    }
    const divisi_id = owner[0].divisi_id;
    
    const [products] = await pool.query(
      `SELECT p.produk_id, p.pcode, p.nama_barang
       FROM stok_wh03 s
       JOIN produk p ON s.produk_id = p.produk_id
       WHERE s.is_active = 1 AND p.divisi_id = ?
       ORDER BY p.nama_barang`,
       [divisi_id]
    );
    res.json(products);
  } catch (error) {
     console.error(error.message);
     res.status(500).send('Server Error');
  }
};

export const getKoliDetailsWH03 = async (req, res) => {
   const { assignment_id, produk_id } = req.params;
  const user_id = req.user.user_id;
  try {
    const [owner] = await pool.query('SELECT user_id FROM opname_assignment WHERE assignment_id = ?', [assignment_id]);
     if (owner.length === 0 || owner[0].user_id !== user_id) {
      return res.status(403).json({ msg: 'Akses ditolak.' });
    }
    
    const [details] = await pool.query(
      `SELECT * FROM opname_details_wh03
       WHERE assignment_id = ? AND produk_id = ?
       ORDER BY opname_at DESC`,
      [assignment_id, produk_id]
    );
    res.json(details);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

export const addOrUpdateKoliDetailWH03 = async (req, res) => {
  const { assignment_id, produk_id, nomor_koli, fisik_pcs } = req.body;
  const user_id = req.user.user_id;

  if (!assignment_id || !produk_id || !nomor_koli || !fisik_pcs) {
    return res.status(400).json({ msg: 'Semua field wajib diisi.' });
  }

  try {
    const [owner] = await pool.query('SELECT user_id FROM opname_assignment WHERE assignment_id = ?', [assignment_id]);
    if (owner.length === 0 || owner[0].user_id !== user_id) {
      return res.status(403).json({ msg: 'Akses ditolak.' });
    }

    const [prod] = await pool.query('SELECT nama_barang FROM produk WHERE produk_id = ?', [produk_id]);
    if (prod.length === 0) return res.status(404).json({ msg: 'Produk tidak ditemukan.' });

    await pool.query(
      `INSERT INTO opname_details_wh03 (assignment_id, produk_id, nama_barang, nomor_koli, fisik_pcs)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         fisik_pcs = VALUES(fisik_pcs),
         opname_at = CURRENT_TIMESTAMP`,
      [assignment_id, produk_id, prod[0].nama_barang, nomor_koli, fisik_pcs]
    );

    res.status(201).json({ msg: `Koli ${nomor_koli} berhasil disimpan.` });

  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

export const deleteKoliDetailWH03 = async (req, res) => {
  const { detail_id } = req.params;
  const user_id = req.user.user_id;

  try {
    const [check] = await pool.query(
      `SELECT a.user_id FROM opname_details_wh03 d 
       JOIN opname_assignment a ON d.assignment_id = a.assignment_id
       WHERE d.detail_id = ?`,
      [detail_id]
    );
    if (check.length === 0 || check[0].user_id !== user_id) {
      return res.status(403).json({ msg: 'Akses ditolak.' });
    }
    
    await pool.query('DELETE FROM opname_details_wh03 WHERE detail_id = ?', [detail_id]);
    res.json({ msg: 'Data koli berhasil dihapus.' });

  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

// ==========================================
// EXPORT MULTIPLE BATCH (Excel & PDF)
// ==========================================

export const exportMultipleBatches = async (req, res) => {
  const { batch_ids, format } = req.body; // format: 'excel' atau 'pdf'

  if (!batch_ids || !Array.isArray(batch_ids) || batch_ids.length === 0) {
    return res.status(400).json({ msg: 'batch_ids harus berupa array dan tidak boleh kosong.' });
  }

  if (!format || !['excel', 'pdf'].includes(format)) {
    return res.status(400).json({ msg: 'Format harus "excel" atau "pdf".' });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // 1. Ambil info semua batch yang dipilih
    const placeholders = batch_ids.map(() => '?').join(',');
    const [batches] = await connection.query(
      `SELECT b.*, u.nama_lengkap as pembuat
       FROM opname_batch b
       JOIN users u ON b.created_by = u.user_id
       WHERE b.batch_id IN (${placeholders}) AND b.status_overall = 'Completed'
       ORDER BY b.created_at DESC`,
      batch_ids
    );

    if (batches.length === 0) {
      return res.status(404).json({ msg: 'Tidak ada batch yang ditemukan atau belum selesai.' });
    }

    if (format === 'excel') {
      // === EXPORT EXCEL DENGAN DETAIL LENGKAP ===
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Ciptastok Admin';
      workbook.created = new Date();

      // Buat sheet ringkasan
      const summarySheet = workbook.addWorksheet('Ringkasan');
      summarySheet.addRow(['Laporan Riwayat Opname - Multiple Batch']).font = { size: 16, bold: true };
      summarySheet.addRow([]);
      summarySheet.addRow(['Total Batch', batches.length]);
      summarySheet.addRow(['Tanggal Export', new Date().toLocaleString('id-ID')]);
      summarySheet.addRow([]);
      
      // Header tabel ringkasan
      summarySheet.addRow(['No', 'Nama Batch', 'Tipe', 'Pembuat', 'Tanggal Dibuat', 'Tanggal Selesai']);
      summarySheet.getRow(6).font = { bold: true };
      summarySheet.getRow(6).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9EAD3' }
      };

      batches.forEach((batch, index) => {
        const tanggalSelesai = batch.completed_at 
          ? new Date(batch.completed_at).toLocaleString('id-ID')
          : 'Belum Selesai';
        
        summarySheet.addRow([
          index + 1,
          batch.nama_batch,
          batch.tipe_opname,
          batch.pembuat,
          new Date(batch.created_at).toLocaleString('id-ID'),
          tanggalSelesai
        ]);
      });

      // Auto-fit columns
      summarySheet.columns = [
        { key: 'no', width: 5 },
        { key: 'nama', width: 30 },
        { key: 'tipe', width: 12 },
        { key: 'pembuat', width: 25 },
        { key: 'dibuat', width: 20 },
        { key: 'selesai', width: 20 }
      ];

      // Untuk setiap batch, buat sheet detail dengan data produk lengkap
      for (const batch of batches) {
        const [assignments] = await connection.query(
          `SELECT a.*, u.nama_lengkap as nama_user, d.nama_divisi, d.kode_divisi as divisi_sales
           FROM opname_assignment a
           LEFT JOIN users u ON a.user_id = u.user_id
           LEFT JOIN divisi d ON u.divisi_id = d.divisi_id
           WHERE a.batch_id = ?
           ORDER BY u.nama_lengkap`,
          [batch.batch_id]
        );

        if (assignments.length === 0) continue;

        // Buat sheet per batch (nama sheet max 31 karakter)
        const sheetName = batch.nama_batch.substring(0, 31);
        const batchSheet = workbook.addWorksheet(sheetName);
        
        batchSheet.addRow([`Batch: ${batch.nama_batch}`]).font = { bold: true, size: 14 };
        batchSheet.addRow([`Tipe: ${batch.tipe_opname}`]);
        batchSheet.addRow([`Pembuat: ${batch.pembuat}`]);
        batchSheet.addRow([`Tanggal: ${new Date(batch.created_at).toLocaleDateString('id-ID')}`]);
        batchSheet.addRow([]);

        // Loop untuk setiap assignment dan tampilkan detail produknya
        for (const assignment of assignments) {
          batchSheet.addRow([`User: ${assignment.nama_user} | Divisi Sales: ${assignment.divisi_sales} | Rak: ${assignment.nomor_rak || '-'} | Status: ${assignment.status_assignment}`]).font = { bold: true, color: { argb: 'FF0066CC' } };
          batchSheet.addRow([]);

          // Ambil detail produk berdasarkan tipe opname
          let details = [];
          if (batch.tipe_opname === 'WH01') {
            const [detailsWH01] = await connection.query(
              `SELECT d.*, p.pcode, p.nama_barang, r.nomor_rak, s.expired_date
               FROM opname_details_wh01 d
               JOIN produk p ON d.produk_id = p.produk_id
               LEFT JOIN stok_wh01 s ON d.produk_id = s.produk_id
               LEFT JOIN rak r ON s.rak_id = r.rak_id
               WHERE d.assignment_id = ?
               ORDER BY p.pcode`,
              [assignment.assignment_id]
            );
            details = detailsWH01;

            // Header kolom untuk WH01
            batchSheet.addRow([
              'PCode', 'Nama Barang', 'Rak',
              'Sistem Karton', 'Sistem Tengah', 'Sistem Pieces',
              'Fisik Karton', 'Fisik Tengah', 'Fisik Pieces',
              'Selisih Karton', 'Selisih Tengah', 'Selisih Pieces', 'Status'
            ]).font = { bold: true };
            batchSheet.getRow(batchSheet.lastRow.number).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFCCE5FF' }
            };

            // Data rows
            details.forEach(d => {
              batchSheet.addRow([
                d.pcode,
                d.nama_barang,
                d.nomor_rak || '-',
                d.sistem_karton || 0,
                d.sistem_tengah || 0,
                d.sistem_pieces || 0,
                d.fisik_karton !== null ? d.fisik_karton : '-',
                d.fisik_tengah !== null ? d.fisik_tengah : '-',
                d.fisik_pieces !== null ? d.fisik_pieces : '-',
                d.status === 'Pending' ? '-' : (d.selisihK || 0),
                d.status === 'Pending' ? '-' : (d.selisihT || 0),
                d.status === 'Pending' ? '-' : (d.selisihP || 0),
                d.status
              ]);
            });

          } else {
            // WH02 dan WH03 (Total Pcs)
            const tableName = batch.tipe_opname === 'WH02' ? 'opname_details_wh02' : 'opname_details_wh03';
            const [detailsPcs] = await connection.query(
              `SELECT d.*, p.pcode, p.nama_barang
               FROM ${tableName} d
               JOIN produk p ON d.produk_id = p.produk_id
               WHERE d.assignment_id = ?
               ORDER BY p.pcode`,
              [assignment.assignment_id]
            );
            details = detailsPcs;

            // Header kolom untuk WH02/WH03
            batchSheet.addRow([
              'PCode', 'Nama Barang', 'Nomor Koli',
              'Sistem Total (Pcs)', 'Fisik (Pcs)', 'Selisih (Pcs)', 'Status'
            ]).font = { bold: true };
            batchSheet.getRow(batchSheet.lastRow.number).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFCCE5FF' }
            };

            // Data rows
            details.forEach(d => {
              batchSheet.addRow([
                d.pcode,
                d.nama_barang,
                d.nomor_koli || '-',
                d.sistem_total_pcs || 0,
                d.fisik_pcs !== null ? d.fisik_pcs : '-',
                d.status === 'Pending' ? '-' : (d.selisih || 0),
                d.status
              ]);
            });
          }

          batchSheet.addRow([]); // Spasi antar assignment
        }

        // Auto-fit columns
        batchSheet.columns.forEach(column => {
          column.width = 15;
        });
        batchSheet.getColumn(2).width = 35; // Nama barang lebih lebar
      }

      // Kirim file Excel
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="riwayat_opname_${new Date().toISOString().split('T')[0]}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();

    } else {
      // === EXPORT PDF DENGAN DETAIL LENGKAP ===
      const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' }); // Landscape untuk tabel lebar
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="riwayat_opname_${new Date().toISOString().split('T')[0]}.pdf"`);
      doc.pipe(res);

      // Judul
      doc.fontSize(18).font('Helvetica-Bold').text('Laporan Riwayat Opname', { align: 'center' });
      doc.fontSize(12).font('Helvetica').text('Multiple Batch Export', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).text(`Total Batch: ${batches.length}`, { align: 'left' });
      doc.text(`Tanggal Export: ${new Date().toLocaleString('id-ID')}`, { align: 'left' });
      doc.moveDown(1.5);

      // Untuk setiap batch
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        if (i > 0) doc.addPage({ layout: 'landscape' });

        const tanggalSelesai = batch.completed_at 
          ? new Date(batch.completed_at).toLocaleString('id-ID')
          : 'Belum Selesai';

        doc.fontSize(14).font('Helvetica-Bold').text(`${i + 1}. ${batch.nama_batch}`, { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica');
        doc.text(`Tipe Opname: ${batch.tipe_opname}`);
        doc.text(`Pembuat: ${batch.pembuat}`);
        doc.text(`Tanggal Dibuat: ${new Date(batch.created_at).toLocaleString('id-ID')}`);
        doc.text(`Tanggal Selesai: ${tanggalSelesai}`);
        doc.moveDown();

        // Ambil assignments
        const [assignments] = await connection.query(
          `SELECT a.*, u.nama_lengkap as nama_user, d.nama_divisi, b.tipe_opname as divisi_sales
           FROM opname_assignment a
           LEFT JOIN users u ON a.user_id = u.user_id
           LEFT JOIN divisi d ON u.divisi_id = d.divisi_id
           LEFT JOIN opname_batch b ON a.batch_id = b.batch_id
           WHERE a.batch_id = ?
           ORDER BY u.nama_lengkap`,
          [batch.batch_id]
        );

        if (assignments.length > 0) {
          doc.fontSize(11).font('Helvetica-Bold').text('Daftar Penugasan:');
          doc.moveDown(0.3);
          
          for (let j = 0; j < assignments.length; j++) {
            const assignment = assignments[j];
            
            doc.fontSize(9).font('Helvetica-Bold');
            doc.text(`  ${j + 1}. ${assignment.nama_user} (${assignment.divisi_sales}) - Rak: ${assignment.nomor_rak || '-'} - Status: ${assignment.status_assignment}`);
            
            // Ambil detail produk (ringkasan saja karena PDF terbatas ruang)
            let totalProduk = 0;
            let totalSesuai = 0;
            let totalSelisih = 0;
            let totalPending = 0;

            if (batch.tipe_opname === 'WH01') {
              const [stats] = await connection.query(
                `SELECT COUNT(*) as total,
                        SUM(CASE WHEN status = 'Sesuai' THEN 1 ELSE 0 END) as sesuai,
                        SUM(CASE WHEN status = 'Selisih' THEN 1 ELSE 0 END) as selisih,
                        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending
                 FROM opname_details_wh01
                 WHERE assignment_id = ?`,
                [assignment.assignment_id]
              );
              totalProduk = stats[0].total;
              totalSesuai = stats[0].sesuai;
              totalSelisih = stats[0].selisih;
              totalPending = stats[0].pending;
            } else {
              const tableName = batch.tipe_opname === 'WH02' ? 'opname_details_wh02' : 'opname_details_wh03';
              const [stats] = await connection.query(
                `SELECT COUNT(*) as total,
                        SUM(CASE WHEN status = 'Sesuai' THEN 1 ELSE 0 END) as sesuai,
                        SUM(CASE WHEN status = 'Selisih' THEN 1 ELSE 0 END) as selisih,
                        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending
                 FROM ${tableName}
                 WHERE assignment_id = ?`,
                [assignment.assignment_id]
              );
              totalProduk = stats[0].total;
              totalSesuai = stats[0].sesuai;
              totalSelisih = stats[0].selisih;
              totalPending = stats[0].pending;
            }

            doc.fontSize(8).font('Helvetica');
            doc.text(`     Total Produk: ${totalProduk} | Sesuai: ${totalSesuai} | Selisih: ${totalSelisih} | Pending: ${totalPending}`, { indent: 20 });
            doc.moveDown(0.2);
          }
        }

        doc.moveDown(1);
      }

      // Footer
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).text(
          `Halaman ${i + 1} dari ${pages.count}`,
          doc.page.margins.left,
          doc.page.height - 50,
          { align: 'center' }
        );
      }

      doc.end();
    }

  } catch (error) {
    console.error('Export error:', error);
    if (!res.headersSent) {
      res.status(500).json({ msg: 'Gagal export data.', error: error.message });
    }
  } finally {
    if (connection) connection.release();
  }
};
