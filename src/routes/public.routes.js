const express = require('express');
const {
  getVendors,
  getVendorById,
  getVendorsByIds,
  getVendorProjects,
  getProjectById,
  getSimilarVendors,
  getAvailableSlots,
  getGallery,
  getStats,
} = require('../controllers/public.controller');
const { getPublishedPosts, getPostBySlug } = require('../controllers/blog.controller');
const { createTicket } = require('../controllers/supportTicket.controller');

const router = express.Router();

router.get('/vendors',                     getVendors);
// /vendors/compare MUST be before /vendors/:id to avoid route conflict
router.get('/vendors/compare',             getVendorsByIds);
router.get('/vendors/:id',                 getVendorById);
router.get('/vendors/:id/projects',        getVendorProjects);
router.get('/vendors/:id/similar',         getSimilarVendors);
router.get('/vendors/:id/available-slots', getAvailableSlots);
router.get('/projects/:id',                getProjectById);
router.get('/gallery',               getGallery);
router.get('/stats',                 getStats);
router.get('/blog',                  getPublishedPosts);
router.get('/blog/:slug',            getPostBySlug);
router.post('/support-tickets',      createTicket);

module.exports = router;
