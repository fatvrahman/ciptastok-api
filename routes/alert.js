import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getAlertSettings,
  updateAlertSetting,
  getLoginWelcomeData,
  updateGlobalAlertSetting,
} from '../controllers/alertController.js';

const router = express.Router();

// User: Get personal alert settings
router.get('/settings', protect, getAlertSettings);

// User: Update personal alert setting
router.put('/settings/:alert_type_id', protect, updateAlertSetting);

// User: Get login welcome data
router.get('/login-welcome', protect, getLoginWelcomeData);

// Admin: Update global alert settings
router.put('/global/:alert_type_id', protect, adminOnly, updateGlobalAlertSetting);

export default router;
