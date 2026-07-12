const express    = require('express');
const controller = require('../controllers/visitor.controller');
const { protect } = require('../middleware/auth');
const rbac       = require('../middleware/rbac');

const router  = express.Router();
const isAdmin = [protect, rbac('admin')];

// Public — no auth required
router.post('/capture',              controller.captureVisitor);
router.post('/track-interest',       controller.trackVendorInterest);
router.get('/session/:sessionId',    controller.getSession);

// Admin only
router.get('/all',   ...isAdmin, controller.getAllVisitors);
router.get('/stats', ...isAdmin, controller.getVisitorStats);

module.exports = router;
