// path: api/routes/masterData.js
import express from 'express';
import {
  getAllDivisi,
  getAllRak,
  getAllKategori,
  getAllRoles,
  createDivisi,
  updateDivisi,
  deleteDivisi,
  migrateUsers
} from '../controllers/masterDataController.js'; // <-- Tambah .js
import { protect, adminOnly } from '../middleware/authMiddleware.js'; // <-- Tambah .js

const router = express.Router();

router.use(protect);
router.use(adminOnly);

router.get('/divisi', getAllDivisi);
router.post('/divisi', createDivisi);
router.put('/divisi/:id', updateDivisi);
router.delete('/divisi/:id', deleteDivisi);
router.put('/divisi/migrate-users/:fromId/:toId', migrateUsers);

router.get('/rak', getAllRak);
router.get('/kategori', getAllKategori);
router.get('/roles', getAllRoles);

export default router; // <-- [PERBAIKAN] Ganti module.exports

