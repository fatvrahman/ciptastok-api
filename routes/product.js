// path: api/routes/product.js
import express from 'express';
import {
  createProduct,
  getAllProducts,
  getSingleProduct, 
  updateProduct,
  deleteProduct,
  uploadProductsWH01,
  uploadProductsWH02,
  uploadProductsWH03
} from '../controllers/productController.js'; // <-- Tambah .js
import { protect, adminOnly } from '../middleware/authMiddleware.js'; // <-- Tambah .js
import upload from '../middleware/uploadMiddleware.js'; // <-- Tambah .js

const router = express.Router();

router.route('/')
  .post(protect, adminOnly, createProduct)
  .get(protect, adminOnly, getAllProducts);

router.route('/:id')
  .get(protect, adminOnly, getSingleProduct) 
  .put(protect, adminOnly, updateProduct)
  .delete(protect, adminOnly, deleteProduct);

// Rute Upload Excel
router.route('/upload/wh01')
  .post(protect, adminOnly, upload.single('file'), uploadProductsWH01);
router.route('/upload/wh02')
  .post(protect, adminOnly, upload.single('file'), uploadProductsWH02);
router.route('/upload/wh03')
  .post(protect, adminOnly, upload.single('file'), uploadProductsWH03);

export default router; // <-- [PERBAIKAN] Ganti module.exports

