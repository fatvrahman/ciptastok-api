import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { testConnection } from './config/db.js';

// --- Impor semua rute ---
import authRoutes from './routes/auth.js';
import productRoutes from './routes/product.js';
import masterDataRoutes from './routes/masterData.js';
import userRoutes from './routes/user.js';
import opnameRoutes from './routes/opname.js';
import dashboardRoutes from './routes/dashboard.js';
import alertRoutes from './routes/alert.js';

const app = express();
const PORT = process.env.PORT || 3001;

// --- [PERBAIKAN] Konfigurasi CORS yang Tepat ---
// Daftar domain yang diizinkan
const allowedOrigins = [
  'http://localhost:3000', // Untuk development lokal Anda
  'https://ciptastok.vercel.app' // Untuk frontend produksi Anda di Vercel
];

app.use(cors({
  origin: function (origin, callback) {
    // Izinkan jika origin ada di dalam daftar 'allowedOrigins'
    // atau jika tidak ada origin (seperti request dari Postman)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Origin tidak diizinkan oleh CORS'));
    }
  },
  credentials: true // Penting untuk mengizinkan pengiriman cookies/token
}));
// --- Batas Perbaikan ---

// Middleware
// app.use(cors()); // <-- [HAPUS] Baris lama ini sudah diganti di atas
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Selamat Datang di Ciptastok API!');
});

// --- Daftarkan rute ---
app.use('/api/auth', authRoutes);
app.use('/api/produk', productRoutes);
app.use('/api/master', masterDataRoutes);
app.use('/api/users', userRoutes);
app.use('/api/opname', opnameRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/alerts', alertRoutes);

app.listen(PORT, () => {
  console.log(`Running in http://localhost:${PORT}`);  // Fix: () bukan ``
  testConnection();
});
