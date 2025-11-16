// path: api/index.js
import 'dotenv/config'; // <-- [UBAH] Menggunakan import
import express from 'express'; // <-- [UBAH]
import cors from 'cors'; // <-- [UBAH]
import { testConnection } from './config/db.js'; // <-- [UBAH] dan tambah .js

// --- [UBAH] Impor semua rute di atas ---
import authRoutes from './routes/auth.js';
import productRoutes from './routes/product.js';
import masterDataRoutes from './routes/masterData.js';
import userRoutes from './routes/user.js';
import opnameRoutes from './routes/opname.js';
import dashboardRoutes from './routes/dashboard.js';
import alertRoutes from './routes/alert.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  exposedHeaders: 'Content-Disposition',
}));
app.use(express.json()); 

app.get('/', (req, res) => {
  res.send('Selamat Datang di Ciptastok API!');
});

// --- [UBAH] Daftarkan rute yang sudah di-impor ---
app.use('/api/auth', authRoutes);
app.use('/api/produk', productRoutes);
app.use('/api/master', masterDataRoutes);
app.use('/api/users', userRoutes);
app.use('/api/opname', opnameRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/alerts', alertRoutes);

app.listen(PORT, () => {
  console.log(`Running in http://localhost:${PORT}`);
  testConnection(); 
});

