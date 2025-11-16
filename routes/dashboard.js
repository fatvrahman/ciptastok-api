// path: api/routes/dashboard.js
import express from 'express';
import { getDashboardStats, getMonthlyStats, getAdditionalMetrics } from '../controllers/dashboardController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// All dashboard routes require authentication
router.use(authenticateToken);

// Get dashboard statistics
router.get('/stats', getDashboardStats);

// Get monthly statistics
router.get('/monthly', getMonthlyStats);

// Get additional metrics
router.get('/metrics', getAdditionalMetrics);

export default router;
