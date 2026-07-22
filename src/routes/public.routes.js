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
  getFeaturedProjects,
  getRelatedProjects,
  getHomepageContent,
  getSiteReviews,
  getStyleCounts,
} = require('../controllers/public.controller');
const { getPublishedPosts, getPostBySlug } = require('../controllers/blog.controller');
const { createTicket } = require('../controllers/supportTicket.controller');
const { getPublicCities, getPublicCategories } = require('../controllers/taxonomy.controller');

const router = express.Router();

router.get('/vendors',                     getVendors);
// /vendors/compare MUST be before /vendors/:id to avoid route conflict
router.get('/vendors/compare',             getVendorsByIds);
router.get('/vendors/:id',                 getVendorById);
router.get('/vendors/:id/projects',        getVendorProjects);
router.get('/vendors/:id/similar',         getSimilarVendors);
router.get('/vendors/:id/available-slots', getAvailableSlots);
router.get('/projects/:id',                getProjectById);
router.get('/projects/:id/related',        getRelatedProjects);
router.get('/featured-projects',     getFeaturedProjects);
router.get('/gallery',               getGallery);
router.get('/stats',                 getStats);
router.get('/blog',                  getPublishedPosts);
router.get('/blog/:slug',            getPostBySlug);
router.post('/support-tickets',      createTicket);
router.get('/cities',                getPublicCities);
router.get('/categories',            getPublicCategories);
router.get('/homepage-content',      getHomepageContent);
router.get('/site-reviews',          getSiteReviews);
router.get('/style-counts',          getStyleCounts);

module.exports = router;
