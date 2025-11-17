// path: api/routes/dashboard.js
import express from 'express';
// --- [TAMBAHKAN] Import controller yang baru ---
import { 
  getDashboardStats, 
  getMonthlyStats, 
  getAdditionalMetrics,
  getLowStockProducts // <--- TAMBAHKAN INI
} from '../controllers/dashboardController.js'; 
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(authenticateToken);

router.get('/stats', getDashboardStats);
router.get('/monthly', getMonthlyStats);
router.get('/metrics', getAdditionalMetrics);

// --- [TAMBAHKAN] Route yang hilang ---
router.get('/low-stock', getLowStockProducts); // <--- TAMBAHKAN INI

export default router;
