// path: api/controllers/productController.js
import { pool } from '../config/db.js'; // <-- Tambah .js
import xlsx from 'xlsx';
import fs from 'fs';
import { logUserActivity } from './userController.js';

// Helper untuk parsing Tanggal Excel
const parseExcelDate = (excelDate) => {
  if (!excelDate) return null;
  let date;
  if (typeof excelDate === 'number') {
    date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
  } else {
    date = new Date(excelDate);
  }
  if (isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().split('T')[0]; // Format YYYY-MM-DD
};

// Helper untuk membaca file dan data master (Divisi, Rak, Kategori)
const readExcelData = async (filePath, connection) => {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });

  if (data.length <= 2) throw new Error('File Excel kosong atau tidak valid.');

  // STRATEGI BARU: Deteksi format berdasarkan isi data, bukan header
  // Karena merged cells membuat header tidak terbaca dengan benar
  
  // Cari baris data pertama (yang punya nilai di kolom NO, DIVISI, atau KODE BARANG yang bukan null/header keyword)
  let headerRowIndex = 0;
  let dataStartIndex = 1;
  
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    
    const rowStr = row.map(cell => String(cell || '').toLowerCase().trim()).join('|');
    
    // Skip jika baris ini adalah header keyword (mengandung "konversi", "tengah", "kecil", "total" di posisi awal)
    if (rowStr.includes('konversi') || rowStr.includes('tengah') || rowStr.includes('kecil')) {
      continue;
    }
    
    // Cek apakah ini adalah baris data (kolom pertama berisi angka, kolom kedua berisi teks kategori)
    const firstCol = String(row[0] || '').trim();
    const secondCol = String(row[1] || '').toUpperCase().trim();
    const thirdCol = String(row[2] || '').trim();
    
    // Jika kolom pertama angka, kolom kedua kategori (BISCUIT, CANDY, dll), kolom ketiga kode produk
    if (firstCol && !isNaN(firstCol) && secondCol && thirdCol && thirdCol.length > 3) {
      dataStartIndex = i;
      break;
    }
  }
  
  // Jika masih belum ketemu, asumsikan data mulai dari baris 3 (karena 3 baris header)
  if (dataStartIndex === 1 && data.length > 3) {
    dataStartIndex = 3;
  }

  const headers = data[headerRowIndex].map(h => {
    if (!h) return '';
    return h.toString().toLowerCase().trim();
  });
  
  console.log('🔍 Debug - Header row index:', headerRowIndex);
  console.log('🔍 Debug - All rows preview:');
  for (let i = 0; i < Math.min(3, data.length); i++) {
    console.log(`   Row ${i}:`, data[i]);
  }
  
  // Map untuk kode_divisi dan nama_divisi
  const [divisiRows] = await connection.query('SELECT divisi_id, kode_divisi, nama_divisi FROM divisi');
  const divisiMap = new Map(divisiRows.map(d => [String(d.kode_divisi).toUpperCase(), d.divisi_id]));
  const divisiNameMap = new Map(divisiRows.map(d => [String(d.nama_divisi).toUpperCase(), d.divisi_id]));

  const [rakRows] = await connection.query('SELECT rak_id, nomor_rak FROM rak');
  const rakMap = new Map(rakRows.map(r => [String(r.nomor_rak).toUpperCase(), r.rak_id]));

  return { data, headers, divisiMap, divisiNameMap, rakMap, dataStartIndex, headerRowIndex };
};

// --- [PERBAIKAN] Ganti 'exports.' menjadi 'export const' ---
export const createProduct = async (req, res) => {
  const { 
    pcode, nama_barang, barcode, divisi_id, warehouse,
    sistem_karton, sistem_tengah, sistem_pieces, expired_date, rak_id,
    sistem_total_pcs_bs, sistem_total_pcs_promo
  } = req.body;

  if (!pcode || !nama_barang || !divisi_id || !warehouse) {
    return res.status(400).json({ msg: 'PCode, Nama Barang, Divisi ID, dan Warehouse wajib diisi.' });
  }

  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const [existing] = await connection.query('SELECT pcode FROM produk WHERE pcode = ?', [pcode]);
    if (existing.length > 0) {
      throw new Error('PCode sudah ada, tidak boleh duplikat.');
    }

    const [result] = await connection.query(
      `INSERT INTO produk (pcode, nama_barang, barcode, divisi_id) VALUES (?, ?, ?, ?)`,
      [pcode, nama_barang, barcode || null, divisi_id]
    );
    
    const newProductId = result.insertId;

    // Buat entry stok HANYA untuk warehouse yang dipilih
    if (warehouse === 'wh01') {
      await connection.query(
        `INSERT INTO stok_wh01 (produk_id, sistem_karton, sistem_tengah, sistem_pieces, expired_date, rak_id, is_active) 
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [newProductId, sistem_karton || 0, sistem_tengah || 0, sistem_pieces || 0, expired_date || null, rak_id || null]
      );
      // Buat entry is_active=0 untuk warehouse lain
      await connection.query(
        'INSERT INTO stok_wh02 (produk_id, sistem_total_pcs, is_active) VALUES (?, 0, 0)', 
        [newProductId]
      );
      await connection.query(
        'INSERT INTO stok_wh03 (produk_id, sistem_total_pcs, is_active) VALUES (?, 0, 0)', 
        [newProductId]
      );
    } else if (warehouse === 'wh02') {
      await connection.query(
        'INSERT INTO stok_wh02 (produk_id, sistem_total_pcs, is_active) VALUES (?, ?, 1)', 
        [newProductId, sistem_total_pcs_bs || 0]
      );
      // Buat entry is_active=0 untuk warehouse lain
      await connection.query(
        `INSERT INTO stok_wh01 (produk_id, sistem_karton, sistem_tengah, sistem_pieces, expired_date, rak_id, is_active) 
         VALUES (?, 0, 0, 0, NULL, NULL, 0)`,
        [newProductId]
      );
      await connection.query(
        'INSERT INTO stok_wh03 (produk_id, sistem_total_pcs, is_active) VALUES (?, 0, 0)', 
        [newProductId]
      );
    } else if (warehouse === 'wh03') {
      await connection.query(
        'INSERT INTO stok_wh03 (produk_id, sistem_total_pcs, is_active) VALUES (?, ?, 1)', 
        [newProductId, sistem_total_pcs_promo || 0]
      );
      // Buat entry is_active=0 untuk warehouse lain
      await connection.query(
        `INSERT INTO stok_wh01 (produk_id, sistem_karton, sistem_tengah, sistem_pieces, expired_date, rak_id, is_active) 
         VALUES (?, 0, 0, 0, NULL, NULL, 0)`,
        [newProductId]
      );
      await connection.query(
        'INSERT INTO stok_wh02 (produk_id, sistem_total_pcs, is_active) VALUES (?, 0, 0)', 
        [newProductId]
      );
    }

    await connection.commit();
    res.status(201).json({ msg: 'Produk master berhasil dibuat', produkId: newProductId });

  } catch (error) {
    await connection.rollback();
    console.error(error.message);
    res.status(500).send(error.message || 'Server Error');
  } finally {
    connection.release();
  }
};

export const getAllProducts = async (req, res) => {
  try {
    const [products] = await pool.query(
      `SELECT 
         p.produk_id, 
         p.pcode, 
         p.nama_barang, 
         p.barcode,
         p.konversi_tengah,
         p.konversi_pcs,
         p.hje_per_karton,
         d.divisi_id,
         d.nama_divisi, 
         d.kode_divisi,
         d.kode_divisi as nama_divisi_sales, 
         s01.sistem_karton, 
         s01.sistem_tengah, 
         s01.sistem_pieces, 
         s01.expired_date, 
         r.nomor_rak,
         s02.sistem_total_pcs as sistem_total_pcs_bs,
         s03.sistem_total_pcs as sistem_total_pcs_promo,
         COALESCE(s01.is_active, 0) as is_active_wh01, 
         COALESCE(s02.is_active, 0) as is_active_wh02, 
         COALESCE(s03.is_active, 0) as is_active_wh03,
         CASE 
           WHEN p.konversi_tengah > 0 AND p.konversi_pcs > 0 THEN
             (COALESCE(s01.sistem_karton, 0) * p.konversi_pcs) + 
             (COALESCE(s01.sistem_tengah, 0) * p.konversi_tengah) + 
             COALESCE(s01.sistem_pieces, 0)
           ELSE NULL
         END as total_in_pcs
       FROM produk p
       LEFT JOIN divisi d ON p.divisi_id = d.divisi_id
       LEFT JOIN stok_wh01 s01 ON p.produk_id = s01.produk_id
       LEFT JOIN rak r ON s01.rak_id = r.rak_id
       LEFT JOIN stok_wh02 s02 ON p.produk_id = s02.produk_id
       LEFT JOIN stok_wh03 s03 ON p.produk_id = s03.produk_id
       ORDER BY p.nama_barang ASC`
    );
    
    res.json(products);

  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

export const getSingleProduct = async (req, res) => {
  const { id } = req.params;
  try {
    const [products] = await pool.query(
      `SELECT 
         p.produk_id, 
         p.pcode, 
         p.nama_barang, 
         p.barcode,
         p.konversi_tengah,
         p.konversi_pcs,
         p.hje_per_karton,
         d.divisi_id,
         d.nama_divisi, 
         d.kode_divisi,
         d.kode_divisi as nama_divisi_sales, 
         s01.sistem_karton, 
         s01.sistem_tengah, 
         s01.sistem_pieces, 
         s01.expired_date, 
         s01.rak_id,
         s02.sistem_total_pcs as sistem_total_pcs_bs,
         s03.sistem_total_pcs as sistem_total_pcs_promo,
         COALESCE(s01.is_active, 0) as is_active_wh01, 
         COALESCE(s02.is_active, 0) as is_active_wh02, 
         COALESCE(s03.is_active, 0) as is_active_wh03,
         CASE 
           WHEN p.konversi_tengah > 0 AND p.konversi_pcs > 0 THEN
             (COALESCE(s01.sistem_karton, 0) * p.konversi_pcs) + 
             (COALESCE(s01.sistem_tengah, 0) * p.konversi_tengah) + 
             COALESCE(s01.sistem_pieces, 0)
           ELSE NULL
         END as total_in_pcs
       FROM produk p
       LEFT JOIN divisi d ON p.divisi_id = d.divisi_id
       LEFT JOIN stok_wh01 s01 ON p.produk_id = s01.produk_id
       LEFT JOIN rak r ON s01.rak_id = r.rak_id
       LEFT JOIN stok_wh02 s02 ON p.produk_id = s02.produk_id
       LEFT JOIN stok_wh03 s03 ON p.produk_id = s03.produk_id
       WHERE p.produk_id = ?`,
      [id]
    );

    if (products.length === 0) {
      return res.status(404).json({ msg: 'Produk tidak ditemukan' });
    }
    
    res.json(products[0]);

  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};


export const updateProduct = async (req, res) => {
  const { id } = req.params;
  const { 
    nama_barang, barcode, divisi_id,
    sistem_karton, sistem_tengah, sistem_pieces, expired_date, rak_id,
    sistem_total_pcs_bs, sistem_total_pcs_promo
  } = req.body;

  if (!nama_barang || !divisi_id) {
    return res.status(400).json({ msg: 'Nama Barang dan Divisi ID wajib diisi.' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Update master produk
    await connection.query(
      `UPDATE produk SET 
        nama_barang = ?, barcode = ?, divisi_id = ?
       WHERE produk_id = ?`,
      [nama_barang, barcode || null, divisi_id, id]
    );

    // 2. Update stok WH01 (UPSERT)
    await connection.query(
      `INSERT INTO stok_wh01 (produk_id, sistem_karton, sistem_tengah, sistem_pieces, expired_date, rak_id) 
       VALUES (?, ?, ?, ?, ?, ?) 
       ON DUPLICATE KEY UPDATE 
         sistem_karton = VALUES(sistem_karton), 
         sistem_tengah = VALUES(sistem_tengah), 
         sistem_pieces = VALUES(sistem_pieces), 
         expired_date = VALUES(expired_date), 
         rak_id = VALUES(rak_id)`,
      [id, sistem_karton || 0, sistem_tengah || 0, sistem_pieces || 0, expired_date || null, rak_id || null]
    );

    // 3. Update stok WH02 (UPSERT)
    await connection.query(
      `INSERT INTO stok_wh02 (produk_id, sistem_total_pcs) VALUES (?, ?) 
       ON DUPLICATE KEY UPDATE sistem_total_pcs = VALUES(sistem_total_pcs)`,
      [id, sistem_total_pcs_bs || 0]
    );

    // 4. Update stok WH03 (UPSERT)
     await connection.query(
      `INSERT INTO stok_wh03 (produk_id, sistem_total_pcs) VALUES (?, ?) 
       ON DUPLICATE KEY UPDATE sistem_total_pcs = VALUES(sistem_total_pcs)`,
      [id, sistem_total_pcs_promo || 0]
    );

    await connection.commit();
    res.json({ msg: 'Produk berhasil diupdate' });

  } catch (error) {
    await connection.rollback();
    console.error(error.message);
    res.status(500).send('Server Error');
  } finally {
    connection.release();
  }
};

export const deleteProduct = async (req, res) => {
  const { id } = req.params;
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    // Cek apakah produk ada di opname details
    const [opnameCheck] = await connection.query(
      `SELECT COUNT(*) as count FROM (
        SELECT produk_id FROM opname_details_wh01 WHERE produk_id = ?
        UNION ALL
        SELECT produk_id FROM opname_details_wh02 WHERE produk_id = ?
        UNION ALL
        SELECT produk_id FROM opname_details_wh03 WHERE produk_id = ?
      ) as combined`,
      [id, id, id]
    );

    if (opnameCheck[0].count > 0) {
      return res.status(400).json({ 
        msg: 'Produk tidak bisa dihapus karena sudah ada di riwayat opname.' 
      });
    }

    // Hapus stok terlebih dahulu (manual cascade)
    await connection.query('DELETE FROM stok_wh01 WHERE produk_id = ?', [id]);
    await connection.query('DELETE FROM stok_wh02 WHERE produk_id = ?', [id]);
    await connection.query('DELETE FROM stok_wh03 WHERE produk_id = ?', [id]);

    // Baru hapus produk
    const [result] = await connection.query('DELETE FROM produk WHERE produk_id = ?', [id]);

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ msg: 'Produk tidak ditemukan' });
    }

    await connection.commit();
    
    // Log aktivitas
    const userId = req.user?.user_id;
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    if (userId) {
      await logUserActivity(userId, `Menghapus produk (ID: ${id})`, ipAddress);
    }
    
    res.json({ msg: 'Produk berhasil dihapus (termasuk semua data stoknya)' });

  } catch (error) {
    await connection.rollback();
    console.error('Delete product error:', error);
    
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ 
        msg: 'Produk tidak bisa dihapus karena masih digunakan di data lain.' 
      });
    }
    
    res.status(500).json({ msg: 'Server Error: ' + error.message });
  } finally {
    connection.release();
  }
};

export const uploadProductsWH01 = async (req, res) => {
  if (!req.file) return res.status(400).json({ msg: 'Tidak ada file.' });

  const filePath = req.file.path;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const { data, headers, divisiMap, divisiNameMap, rakMap, dataStartIndex, headerRowIndex } = await readExcelData(filePath, connection);

    // Header Map untuk FORMAT BARU (Template User)
    // Template dengan 12 kolom:
    // NO | DIVISI | KODE BARANG | NAMA BARANG | KONVERSI TENGAH | KONVERSI KECIL | 
    // KARTON | TENGAH | KECIL | HJE PER KARTON | RAK | BARCODE
    const headerMap = {
      'no': 'no',
      'divisi': 'kategori',  // Kategori produk (BISCUIT, CANDY, dll)
      'kode barang': 'pcode',
      'nama barang': 'nama_barang',
      'konversi tengah': 'konversi_tengah',
      'konversi pcs': 'konversi_pcs',
      'konversi kecil': 'konversi_pcs',  // Alias
      'karton': 'sistem_karton',
      'tengah': 'sistem_tengah',
      'kecil': 'sistem_pieces',
      'pieces': 'sistem_pieces',  // Alias
      'pcs': 'sistem_pieces',
      'hje per karton': 'hje_per_karton',
      'harga per karton': 'hje_per_karton',
      'hje/karton': 'hje_per_karton',
      'rak': 'nomor_rak',
      'rak ': 'nomor_rak',  // Handle trailing space
      'nomor rak': 'nomor_rak',
      'barcode': 'barcode',
      // Backward compatibility dengan format lama
      'pcode': 'pcode',
      'kode divisi': 'kode_divisi',
      'expired date': 'expired_date'
    };
    
    // --- [LOGIKA OTOMATIS] Langkah A: Non-aktifkan semua stok WH01 ---
    await connection.query('UPDATE stok_wh01 SET is_active = 0');
    
    // Debug logging
    console.log('📋 Headers detected:', headers);
    console.log('📊 Data will start from row:', dataStartIndex);
    
    let processedCount = 0;
    const errors = [];
    
    for (let i = dataStartIndex; i < data.length; i++) {
      const rowData = data[i];
      if (!rowData || rowData.length === 0) continue;

      let row = {};
      
      // STRATEGI PRIMARY: POSITION-BASED mapping (untuk handle merged cells)
      // Template Excel User (TOTAL section):
      // Kolom: KARTON | TENGAH | KECIL | TOTAL IN PCS
      // 
      // KONVERSI YANG BENAR:
      // - 1 KARTON = KONVERSI_KECIL pcs (misal: 1 karton = 20 pcs)
      // - 1 TENGAH = KONVERSI_TENGAH pcs (misal: 1 tengah = 5 pcs)
      // - 1 KECIL = 1 pcs
      // 
      // FORMULA TOTAL IN PCS:
      // Total = (Karton × Konversi_Kecil) + (Tengah × Konversi_Tengah) + Kecil
      // 
      // STRUKTUR TEMPLATE (11 kolom):
      // 0=NO, 1=DIVISI, 2=KODE, 3=NAMA, 4=KONV_TENGAH, 5=KONV_KECIL, 
      // 6=HJE, 7=STOCK MATRIX (IN KARTON) - decimal, 8=STOCK MATRIX (IN PCS) - total, 9=RAK, 10=BARCODE
      // 
      // Template terbaru (dari gambar user):
      // - Col 7: STOCK MATRIX (IN KARTON) = desimal seperti 50.850 (untuk display saja)
      // - Col 8: STOCK MATRIX (IN PCS) = 1017 (TOTAL yang perlu di-breakdown)
      // - Logic: Breakdown col 8 (total PCS) menjadi Karton + Tengah + Pieces
      if (rowData.length >= 9) {
        row.no = rowData[0];
        row.kategori = rowData[1];
        row.pcode = rowData[2];
        row.nama_barang = rowData[3];
        row.konversi_tengah = rowData[4];
        row.konversi_pcs = rowData[5];
        row.hje_per_karton = rowData[6];
        
        const col7 = parseFloat(rowData[7]) || 0;
        const col8 = parseFloat(rowData[8]) || 0;
        
        const konversiTengah = parseInt(row.konversi_tengah) || 1;
        const konversiPcs = parseInt(row.konversi_pcs) || 1;
        
        // Template baru: Col 8 adalah TOTAL IN PCS yang perlu di-breakdown
        // Breakdown logic:
        // 1. Karton = floor(total / konversi_pcs)
        // 2. Remaining pcs setelah karton
        // 3. Tengah = floor(remaining / konversi_tengah)
        // 4. Pieces = remaining setelah tengah
        
        const totalPcs = col8;
        
        if (totalPcs > 0 && konversiPcs > 0 && konversiTengah > 0) {
          // Step 1: Calculate karton
          row.sistem_karton = Math.floor(totalPcs / konversiPcs);
          
          // Step 2: Calculate remaining after karton
          let remaining = totalPcs - (row.sistem_karton * konversiPcs);
          
          // Step 3: Calculate tengah from remaining
          row.sistem_tengah = Math.floor(remaining / konversiTengah);
          
          // Step 4: Calculate pieces (what's left)
          row.sistem_pieces = remaining - (row.sistem_tengah * konversiTengah);
        } else {
          // Fallback jika data tidak lengkap
          row.sistem_karton = 0;
          row.sistem_tengah = 0;
          row.sistem_pieces = 0;
        }
        
        // RAK dan BARCODE di kolom berikutnya
        if (rowData.length >= 10) row.nomor_rak = rowData[9];
        if (rowData.length >= 11) row.barcode = rowData[10];
      } else {
        // FALLBACK: Mapping berdasarkan header name (untuk format lama)
        headers.forEach((header, index) => {
          if (headerMap[header]) row[headerMap[header]] = rowData[index];
        });
      }

      // Debug first row
      if (i === dataStartIndex) {
        console.log('🔍 First data row (raw):', rowData);
        console.log('🔍 Parsing hasil:');
        console.log('   - pcode:', row.pcode);
        console.log('   - kategori:', row.kategori);
        console.log('   - konversi_tengah:', row.konversi_tengah, 'pcs per tengah');
        console.log('   - konversi_pcs:', row.konversi_pcs, 'pcs per karton');
        console.log('   ');
        console.log('   📦 Stock breakdown:');
        console.log(`   - Karton: ${row.sistem_karton}`);
        console.log(`   - Tengah: ${row.sistem_tengah}`);
        console.log(`   - Pieces/Kecil: ${row.sistem_pieces}`);
        console.log('   ');
        console.log('   🧮 Total IN PCS calculation:');
        const totalCalc = (row.sistem_karton * parseInt(row.konversi_pcs)) + 
                         (row.sistem_tengah * parseInt(row.konversi_tengah)) + 
                         row.sistem_pieces;
        console.log(`   (${row.sistem_karton} × ${row.konversi_pcs}) + (${row.sistem_tengah} × ${row.konversi_tengah}) + ${row.sistem_pieces}`);
        console.log(`   = ${row.sistem_karton * parseInt(row.konversi_pcs)} + ${row.sistem_tengah * parseInt(row.konversi_tengah)} + ${row.sistem_pieces}`);
        console.log(`   = ${totalCalc} PCS`);
        console.log('   ');
        console.log('   - hje_per_karton:', row.hje_per_karton);
        console.log('   - nomor_rak:', row.nomor_rak);
        console.log('   - barcode:', row.barcode);
      }

      // Validasi kolom wajib
      if (!row.pcode || !row.nama_barang) {
        errors.push(`Baris ${i+1}: pcode atau nama barang kosong.`);
        continue;
      }

      // Tentukan divisi_id: prioritas kategori > nama_divisi > kode_divisi
      let divisiId = null;
      
      if (row.kategori) {
        const kategoriUpper = String(row.kategori).toUpperCase().trim();
        // 1. Cek langsung di divisi.nama_divisi
        divisiId = divisiNameMap.get(kategoriUpper);
        // 2. Jika tidak ada, cek di divisi.kode_divisi
        if (!divisiId) {
          divisiId = divisiMap.get(kategoriUpper);
        }
        if (!divisiId) {
          errors.push(`Baris ${i+1}: Divisi/Kategori "${row.kategori}" tidak ditemukan.`);
          continue;
        }
      } else if (row.kode_divisi) {
        // Format lama: cari berdasarkan kode_divisi
        divisiId = divisiMap.get(String(row.kode_divisi).toUpperCase());
        if (!divisiId) {
          errors.push(`Baris ${i+1}: Kode Divisi "${row.kode_divisi}" tidak ditemukan.`);
          continue;
        }
      } else {
        errors.push(`Baris ${i+1}: Tidak ada kategori atau kode divisi.`);
        continue;
      }
      
      // Mapping rak_id: cari di database atau buat baru jika belum ada
      let rakId = null;
      if (row.nomor_rak) {
        const nomorRakClean = String(row.nomor_rak).trim();
        const nomorRakUpper = nomorRakClean.toUpperCase();
        rakId = rakMap.get(nomorRakUpper);
        
        if (i === dataStartIndex) {
          console.log(`   🔍 Mencari rak: "${nomorRakClean}" (uppercase: "${nomorRakUpper}")`);
          console.log(`   🔍 Rak ditemukan di map:`, rakId);
        }
        
        // Jika rak belum ada, buat baru dan update rakMap
        if (!rakId && nomorRakClean) {
          try {
            const [insertRak] = await connection.query(
              'INSERT IGNORE INTO rak (nomor_rak) VALUES (?)',
              [nomorRakClean]
            );
            
            // Ambil rak_id yang baru dibuat atau yang sudah ada
            const [rakResult] = await connection.query(
              'SELECT rak_id FROM rak WHERE nomor_rak = ?',
              [nomorRakClean]
            );
            
            if (rakResult.length > 0) {
              rakId = rakResult[0].rak_id;
              rakMap.set(nomorRakUpper, rakId);
              console.log(`   ✅ Rak baru dibuat/ditemukan: "${nomorRakClean}" (ID: ${rakId})`);
            }
          } catch (err) {
            console.warn(`   ⚠️ Gagal membuat rak "${nomorRakClean}":`, err.message);
          }
        } else if (rakId && i === dataStartIndex) {
          console.log(`   ✅ Rak sudah ada: "${nomorRakClean}" (ID: ${rakId})`);
        }
      }

      // 1. Buat/Update master produk (termasuk kolom konversi dan harga)
      await connection.query(
        `INSERT INTO produk (pcode, nama_barang, divisi_id, barcode, konversi_tengah, konversi_pcs, hje_per_karton) 
         VALUES (?, ?, ?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE 
           nama_barang = VALUES(nama_barang), 
           divisi_id = VALUES(divisi_id), 
           barcode = VALUES(barcode),
           konversi_tengah = VALUES(konversi_tengah),
           konversi_pcs = VALUES(konversi_pcs),
           hje_per_karton = VALUES(hje_per_karton)`,
        [
          row.pcode, 
          row.nama_barang, 
          divisiId, 
          row.barcode || null,
          parseInt(row.konversi_tengah) || null,
          parseInt(row.konversi_pcs) || null,
          parseFloat(row.hje_per_karton) || null
        ]
      );

      // 2. Dapatkan produk_id
      const [product] = await connection.query('SELECT produk_id FROM produk WHERE pcode = ?', [row.pcode]);
      const produk_id = product[0].produk_id;

      // 3. Buat/Update stok WH01
      await connection.query(
        `INSERT INTO stok_wh01 (
          produk_id, sistem_karton, sistem_tengah, sistem_pieces, expired_date, rak_id, is_active
         ) VALUES (?, ?, ?, ?, ?, ?, 1) 
         ON DUPLICATE KEY UPDATE 
           sistem_karton = VALUES(sistem_karton), 
           sistem_tengah = VALUES(sistem_tengah), 
           sistem_pieces = VALUES(sistem_pieces), 
           expired_date = VALUES(expired_date), 
           rak_id = VALUES(rak_id),
           is_active = 1`,
        [
          produk_id,
          parseFloat(row.sistem_karton) || 0,
          parseFloat(row.sistem_tengah) || 0,
          parseFloat(row.sistem_pieces) || 0,
          parseExcelDate(row.expired_date),
          rakId
        ]
      );

      // 4. Pastikan entry WH02 dan WH03 ada (is_active=0 jika tidak ada)
      await connection.query(
        `INSERT IGNORE INTO stok_wh02 (produk_id, sistem_total_pcs, is_active) VALUES (?, 0, 0)`,
        [produk_id]
      );
      await connection.query(
        `INSERT IGNORE INTO stok_wh03 (produk_id, sistem_total_pcs, is_active) VALUES (?, 0, 0)`,
        [produk_id]
      );

      processedCount++;
    }

    await connection.commit();
    
    // Log aktivitas
    const userId = req.user?.user_id;
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    if (userId) {
      await logUserActivity(userId, `Upload produk WH01: ${processedCount} produk diproses`, ipAddress);
    }
    
    let message = `Upload WH01 sukses! ${processedCount} produk berhasil diproses.`;
    if (errors.length > 0) {
      message += ` ${errors.length} baris dilewati karena error.`;
    }
    
    res.json({ 
      msg: message,
      processedCount,
      errors: errors.length > 0 ? errors.slice(0, 10) : [] // Maksimal 10 error pertama
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error saat upload WH01:', error);
    res.status(500).json({ msg: error.message || 'Server Error.' });
  } finally {
    connection.release();
    fs.unlink(filePath, (err) => { if (err) console.error("Gagal hapus file temp:", err); });
  }
};


export const uploadProductsWH02 = async (req, res) => {
  if (!req.file) return res.status(400).json({ msg: 'Tidak ada file.' });

  const filePath = req.file.path;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const { data, headers, divisiMap, divisiNameMap, dataStartIndex } = await readExcelData(filePath, connection);

    // Header Wajib WH02 - Support format baru dan lama
    const headerMap = {
      'no': 'no',
      'divisi': 'kategori',
      'kode barang': 'pcode',
      'nama barang': 'nama_barang',
      'konversi tengah': 'konversi_tengah',
      'konversi pcs': 'konversi_pcs',
      'konversi kecil': 'konversi_pcs',
      'total in pcs': 'sistem_total_pcs_bs',
      // Backward compatibility
      'pcode': 'pcode',
      'kode divisi': 'kode_divisi',
      'total pcs': 'sistem_total_pcs_bs', 
      'barcode': 'barcode'
    };
    
    // --- [LOGIKA OTOMATIS] Langkah A: Non-aktifkan semua stok WH02 ---
    await connection.query('UPDATE stok_wh02 SET is_active = 0');
    
    let processedCount = 0;
    const errors = [];
    
    for (let i = dataStartIndex; i < data.length; i++) {
      const rowData = data[i];
      if (rowData.length === 0) continue;

      let row = {};
      headers.forEach((header, index) => {
        if (headerMap[header]) row[headerMap[header]] = rowData[index];
      });

      if (!row.pcode || !row.nama_barang) {
        errors.push(`Baris ${i+1}: pcode atau nama barang kosong.`);
        continue;
      }

      // Tentukan divisi_id
      let divisiId = null;
      
      if (row.kategori) {
        const kategoriUpper = String(row.kategori).toUpperCase().trim();
        // 1. Cek langsung di divisi.nama_divisi
        divisiId = divisiNameMap.get(kategoriUpper);
        // 2. Jika tidak ada, cek di divisi.kode_divisi
        if (!divisiId) {
          divisiId = divisiMap.get(kategoriUpper);
        }
        if (!divisiId) {
          errors.push(`Baris ${i+1}: Kategori "${row.kategori}" tidak ditemukan.`);
          continue;
        }
      } else if (row.kode_divisi) {
        divisiId = divisiMap.get(String(row.kode_divisi).toUpperCase());
        if (!divisiId) {
          errors.push(`Baris ${i+1}: Kode Divisi "${row.kode_divisi}" tidak ditemukan.`);
          continue;
        }
      } else {
        errors.push(`Baris ${i+1}: Tidak ada kategori atau kode divisi.`);
        continue;
      }

      // 1. Buat/Update master produk
      await connection.query(
        `INSERT INTO produk (pcode, nama_barang, divisi_id, barcode, konversi_tengah, konversi_pcs) 
         VALUES (?, ?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE 
           nama_barang = VALUES(nama_barang), 
           divisi_id = VALUES(divisi_id), 
           barcode = VALUES(barcode),
           konversi_tengah = VALUES(konversi_tengah),
           konversi_pcs = VALUES(konversi_pcs)`,
        [
          row.pcode, 
          row.nama_barang, 
          divisiId, 
          row.barcode || null,
          parseInt(row.konversi_tengah) || null,
          parseInt(row.konversi_pcs) || null
        ]
      );

      // 2. Dapatkan produk_id
      const [product] = await connection.query('SELECT produk_id FROM produk WHERE pcode = ?', [row.pcode]);
      const produk_id = product[0].produk_id;

      // 3. Buat/Update stok WH02
      await connection.query(
        `INSERT INTO stok_wh02 (produk_id, sistem_total_pcs, is_active) VALUES (?, ?, 1) 
         ON DUPLICATE KEY UPDATE 
           sistem_total_pcs = VALUES(sistem_total_pcs),
           is_active = 1`,
        [
          produk_id,
          parseInt(row.sistem_total_pcs_bs) || 0
        ]
      );

      // 4. Pastikan entry WH01 dan WH03 ada (is_active=0 jika tidak ada)
      await connection.query(
        `INSERT IGNORE INTO stok_wh01 (produk_id, sistem_karton, sistem_tengah, sistem_pieces, is_active) VALUES (?, 0, 0, 0, 0)`,
        [produk_id]
      );
      await connection.query(
        `INSERT IGNORE INTO stok_wh03 (produk_id, sistem_total_pcs, is_active) VALUES (?, 0, 0)`,
        [produk_id]
      );

      processedCount++;
    }

    await connection.commit();
    
    // Log aktivitas
    const userId = req.user?.user_id;
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    if (userId) {
      await logUserActivity(userId, `Upload produk WH02: ${processedCount} produk diproses`, ipAddress);
    }
    
    let message = `Upload WH02 sukses! ${processedCount} produk berhasil diproses.`;
    if (errors.length > 0) {
      message += ` ${errors.length} baris dilewati.`;
    }
    
    res.json({ 
      msg: message,
      processedCount,
      errors: errors.length > 0 ? errors.slice(0, 10) : []
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error saat upload WH02:', error);
    res.status(500).json({ msg: error.message || 'Server Error.' });
  } finally {
    connection.release();
    fs.unlink(filePath, (err) => { if (err) console.error("Gagal hapus file temp:", err); });
  }
};

export const uploadProductsWH03 = async (req, res) => {
  if (!req.file) return res.status(400).json({ msg: 'Tidak ada file.' });

  const filePath = req.file.path;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const { data, headers, divisiMap, divisiNameMap, dataStartIndex } = await readExcelData(filePath, connection);

    // Header Wajib WH03 - Support format baru dan lama
    const headerMap = {
      'no': 'no',
      'divisi': 'kategori',
      'kode barang': 'pcode',
      'nama barang': 'nama_barang',
      'konversi tengah': 'konversi_tengah',
      'konversi pcs': 'konversi_pcs',
      'konversi kecil': 'konversi_pcs',
      'total in pcs': 'sistem_total_pcs_promo',
      // Backward compatibility
      'pcode': 'pcode',
      'kode divisi': 'kode_divisi',
      'total pcs': 'sistem_total_pcs_promo', 
      'barcode': 'barcode'
    };
    
    // --- [LOGIKA OTOMATIS] Langkah A: Non-aktifkan semua stok WH03 ---
    await connection.query('UPDATE stok_wh03 SET is_active = 0');
    
    let processedCount = 0;
    const errors = [];
    
    for (let i = dataStartIndex; i < data.length; i++) {
      const rowData = data[i];
      if (rowData.length === 0) continue;

      let row = {};
      headers.forEach((header, index) => {
        if (headerMap[header]) row[headerMap[header]] = rowData[index];
      });

      if (!row.pcode || !row.nama_barang) {
        errors.push(`Baris ${i+1}: pcode atau nama barang kosong.`);
        continue;
      }

      // Tentukan divisi_id
      let divisiId = null;
      
      if (row.kategori) {
        const kategoriUpper = String(row.kategori).toUpperCase().trim();
        // 1. Cek langsung di divisi.nama_divisi
        divisiId = divisiNameMap.get(kategoriUpper);
        // 2. Jika tidak ada, cek di divisi.kode_divisi
        if (!divisiId) {
          divisiId = divisiMap.get(kategoriUpper);
        }
        if (!divisiId) {
          errors.push(`Baris ${i+1}: Kategori "${row.kategori}" tidak ditemukan.`);
          continue;
        }
      } else if (row.kode_divisi) {
        divisiId = divisiMap.get(String(row.kode_divisi).toUpperCase());
        if (!divisiId) {
          errors.push(`Baris ${i+1}: Kode Divisi "${row.kode_divisi}" tidak ditemukan.`);
          continue;
        }
      } else {
        errors.push(`Baris ${i+1}: Tidak ada kategori atau kode divisi.`);
        continue;
      }

      // 1. Buat/Update master produk
      await connection.query(
        `INSERT INTO produk (pcode, nama_barang, divisi_id, barcode, konversi_tengah, konversi_pcs) 
         VALUES (?, ?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE 
           nama_barang = VALUES(nama_barang), 
           divisi_id = VALUES(divisi_id), 
           barcode = VALUES(barcode),
           konversi_tengah = VALUES(konversi_tengah),
           konversi_pcs = VALUES(konversi_pcs)`,
        [
          row.pcode, 
          row.nama_barang, 
          divisiId, 
          row.barcode || null,
          parseInt(row.konversi_tengah) || null,
          parseInt(row.konversi_pcs) || null
        ]
      );

      // 2. Dapatkan produk_id
      const [product] = await connection.query('SELECT produk_id FROM produk WHERE pcode = ?', [row.pcode]);
      const produk_id = product[0].produk_id;

      // 3. Buat/Update stok WH03
      await connection.query(
        `INSERT INTO stok_wh03 (produk_id, sistem_total_pcs, is_active) VALUES (?, ?, 1) 
         ON DUPLICATE KEY UPDATE 
           sistem_total_pcs = VALUES(sistem_total_pcs),
           is_active = 1`,
        [
          produk_id,
          parseInt(row.sistem_total_pcs_promo) || 0
        ]
      );

      // 4. Pastikan entry WH01 dan WH02 ada (is_active=0 jika tidak ada)
      await connection.query(
        `INSERT IGNORE INTO stok_wh01 (produk_id, sistem_karton, sistem_tengah, sistem_pieces, is_active) VALUES (?, 0, 0, 0, 0)`,
        [produk_id]
      );
      await connection.query(
        `INSERT IGNORE INTO stok_wh02 (produk_id, sistem_total_pcs, is_active) VALUES (?, 0, 0)`,
        [produk_id]
      );

      processedCount++;
    }

    await connection.commit();
    
    // Log aktivitas
    const userId = req.user?.user_id;
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    if (userId) {
      await logUserActivity(userId, `Upload produk WH03: ${processedCount} produk diproses`, ipAddress);
    }
    
    let message = `Upload WH03 sukses! ${processedCount} produk berhasil diproses.`;
    if (errors.length > 0) {
      message += ` ${errors.length} baris dilewati.`;
    }
    
    res.json({ 
      msg: message,
      processedCount,
      errors: errors.length > 0 ? errors.slice(0, 10) : []
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error saat upload WH03:', error);
    res.status(500).json({ msg: error.message || 'Server Error.' });
  } finally {
    connection.release();
    fs.unlink(filePath, (err) => { if (err) console.error("Gagal hapus file temp:", err); });
  }
};

