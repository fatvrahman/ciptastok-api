// path: api/routes/auth.js
import express from 'express';
import { registerUser, loginUser, logoutUser } from '../controllers/authController.js'; // <-- Tambah .js
import { protect } from '../middleware/authMiddleware.js'; // [BARU] Import middleware

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/logout', protect, logoutUser); // [BARU] Route logout dengan auth

export default router; // <-- [PERBAIKAN] Ganti module.exports

