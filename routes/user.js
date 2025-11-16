// path: api/routes/user.js
import express from 'express';
import {
  getAllUsers,
  updateUser,
  deleteUser,
  getUserLogs
} from '../controllers/userController.js'; // <-- Tambah .js
import { registerUser } from '../controllers/authController.js'; // <-- Tambah .js
import { protect, adminOnly } from '../middleware/authMiddleware.js'; // <-- Tambah .js

const router = express.Router();

router.use(protect);
router.use(adminOnly);

router.route('/')
  .get(getAllUsers);

router.post('/register', registerUser); 

router.get('/logs', getUserLogs); // [BARU] Route untuk log aktivitas

router.route('/:id')
  .put(updateUser)
  .delete(deleteUser);

export default router; // <-- [PERBAIKAN] Ganti module.exports

