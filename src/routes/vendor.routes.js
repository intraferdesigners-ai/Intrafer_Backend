const express = require('express');
const {
  getProfile, updateProfile, updateAvailability,
  createProject, getProjects, getProjectById, updateProject, deleteProject, reorderProjects,
  getAnalytics,
} = require('../controllers/vendor.controller');
const { protect } = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const validate = require('../middleware/validate');
const { upload } = require('../middleware/upload');
const { updateProfileRules } = require('../validators/vendor.validator');

const router = express.Router();

const isVendor = [protect, rbac('vendor')];

router.get('/profile',         ...isVendor, getProfile);
router.put('/profile',         ...isVendor, ...updateProfileRules, validate, updateProfile);
router.put('/availability',    ...isVendor, updateAvailability);
// reorder MUST be before /:id to avoid route conflict
router.put('/projects/reorder', ...isVendor, reorderProjects);
router.get('/projects',        ...isVendor, getProjects);
router.get('/projects/:id',    ...isVendor, getProjectById);
router.post('/projects',       ...isVendor, (req, res, next) => { req.uploadFolder = 'projects'; next(); }, upload.array('images', 10), createProject);
router.put('/projects/:id',    ...isVendor, (req, res, next) => { req.uploadFolder = 'projects'; next(); }, upload.array('images', 10), updateProject);
router.delete('/projects/:id', ...isVendor, deleteProject);
router.get('/analytics',       ...isVendor, getAnalytics);

module.exports = router;
