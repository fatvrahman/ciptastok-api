// path: api/routes/opname.js
import express from 'express';
import {
  createOpnameBatch,
  getAllBatches,
  getAssignmentsByBatch,
  getAssignmentDetailsForAdmin,
  approveOrRejectAssignment,
  deleteAssignment, // <-- [BARU] Import delete function
  getAllActiveAssignments, 
  getSingleAssignmentInfo,
  downloadLaporanExcel, // <-- [BARU] Impor fungsi Excel
  downloadLaporanPdf, // <--- [TAMBAHKAN INI]
  exportMultipleBatches, // <--- [BARU] Export multiple batch
  getMyActiveTask,
  submitOpname,
  getOpnameDetailsWH01,
  updateOpnameDetailWH01,
  getProductsForWH02Task, 
  getKoliDetailsWH02,
  addOrUpdateKoliDetailWH02,
  deleteKoliDetailWH02,
  getProductsForWH03Task,
  getKoliDetailsWH03,
  addOrUpdateKoliDetailWH03,
  deleteKoliDetailWH03
} from '../controllers/opnameController.js'; 

import { protect, adminOnly } from '../middleware/authMiddleware.js'; 

const router = express.Router();

// === SEMUA RUTE OPNAME WAJIB LOGIN ===
router.use(protect); 

// ===================================
// RUTE UNTUK ADMIN (Web Dashboard)
// ===================================
router.post('/batch', adminOnly, createOpnameBatch);
router.get('/batch', adminOnly, getAllBatches);
router.get('/batch/:id', adminOnly, getAssignmentsByBatch); 
router.get('/assignment/:assignment_id', adminOnly, getAssignmentDetailsForAdmin);
router.post('/approve/:assignment_id', adminOnly, approveOrRejectAssignment);
router.delete('/assignment/:assignment_id', adminOnly, deleteAssignment); // <-- [BARU] Route delete
router.get('/assignments/active', adminOnly, getAllActiveAssignments);
router.get('/batch/assignment-info/:assignment_id', adminOnly, getSingleAssignmentInfo);

// --- [BARU] Rute untuk Download Laporan ---
router.get('/laporan/excel/:batch_id', adminOnly, downloadLaporanExcel);
router.get('/laporan/pdf/:batch_id', adminOnly, downloadLaporanPdf); // <--- [TAMBAHKAN INI]

// --- [BARU] Rute untuk Export Multiple Batch ---
router.post('/export', adminOnly, exportMultipleBatches);

// ===================================
// RUTE UNTUK USER (Mobile App - Umum)
// ===================================
router.get('/mytask', getMyActiveTask);
router.post('/submit/:assignment_id', submitOpname);

// ... (Sisa rute mobile Anda WH01, WH02, WH03) ...
router.get('/details/wh01/:assignment_id', getOpnameDetailsWH01);
router.put('/details/wh01/:detail_id', updateOpnameDetailWH01);
router.get('/products/wh02/:assignment_id', getProductsForWH02Task);
router.get('/details/wh02/:assignment_id/:produk_id', getKoliDetailsWH02);
router.post('/details/wh02', addOrUpdateKoliDetailWH02);
router.delete('/details/wh02/:detail_id', deleteKoliDetailWH02);
router.get('/products/wh03/:assignment_id', getProductsForWH03Task);
router.get('/details/wh03/:assignment_id/:produk_id', getKoliDetailsWH03);
router.post('/details/wh03', addOrUpdateKoliDetailWH03);
router.delete('/details/wh03/:detail_id', deleteKoliDetailWH03);

export default router;

