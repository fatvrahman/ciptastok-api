-- Test Data untuk verifikasi mapping kategori_divisi
-- Run this after add_kategori_divisi_mapping.sql

-- Cek semua mapping kategori ke divisi
SELECT 
  kd.nama_kategori,
  d.kode_divisi,
  d.nama_divisi,
  kd.created_at
FROM kategori_divisi kd
JOIN divisi d ON kd.divisi_id = d.divisi_id
ORDER BY d.kode_divisi, kd.nama_kategori;

-- Expected result:
-- BISCUIT    -> BIS
-- CANDY      -> CWC
-- WAFER      -> CWC  
-- JELLY      -> CWC
-- BEVERAGE   -> M3
-- HOME CARE  -> M3
-- CEREAL     -> MU245
-- COFFEE     -> MU245
-- NOODLE     -> MU245

-- Cek struktur tabel produk (harus ada konversi_tengah dan konversi_pcs)
DESCRIBE produk;

-- Sample query untuk test upload result
SELECT 
  p.pcode,
  p.nama_barang,
  p.konversi_tengah,
  p.konversi_pcs,
  d.kode_divisi,
  kd.nama_kategori,
  s.sistem_karton,
  s.sistem_tengah,
  s.sistem_pieces,
  s.is_active
FROM produk p
LEFT JOIN divisi d ON p.divisi_id = d.divisi_id
LEFT JOIN kategori_divisi kd ON kd.divisi_id = d.divisi_id
LEFT JOIN stok_wh01 s ON p.produk_id = s.produk_id
WHERE s.is_active = 1
ORDER BY d.kode_divisi, p.nama_barang;
