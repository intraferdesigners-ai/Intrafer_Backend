const express = require('express');
const {
  getVendors,
  getVendorById,
  getVendorProjects,
  getProjectById,
  getSimilarVendors,
  getGallery,
  getStats,
} = require('../controllers/public.controller');

const router = express.Router();

router.get('/vendors',               getVendors);
router.get('/vendors/:id',           getVendorById);
router.get('/vendors/:id/projects',  getVendorProjects);
router.get('/vendors/:id/similar',   getSimilarVendors);
router.get('/projects/:id',          getProjectById);
router.get('/gallery',               getGallery);
router.get('/stats',                 getStats);

module.exports = router;
