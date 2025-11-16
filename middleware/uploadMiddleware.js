// path: api/middleware/uploadMiddleware.js
import multer from 'multer'; // <-- [UBAH] Gunakan import
import path from 'path'; // <-- [UBAH] Gunakan import

// Konfigurasi penyimpanan sementara (di folder 'uploads/' di server)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Pastikan Anda sudah membuat folder 'uploads' di 'api/'
  },
  filename: function (req, file, cb) {
    // Buat nama file unik agar tidak bentrok
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

// Filter file (hanya terima file Excel)
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel' // .xls
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Format file tidak didukung. Harap upload .xlsx atau .xls'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 1024 * 1024 * 5 } // Batas 5MB
});

export default upload; // <-- [PERBAIKAN] Ganti module.exports

