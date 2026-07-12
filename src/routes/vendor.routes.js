const express = require('express');
const {
  getProfile, updateProfile,
  createProject, getProjects, updateProject, deleteProject, reorderProjects,
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
// reorder MUST be before /:id to avoid route conflict
router.put('/projects/reorder', ...isVendor, reorderProjects);
router.get('/projects',        ...isVendor, getProjects);
router.post('/projects',       ...isVendor, (req, res, next) => { req.uploadFolder = 'projects'; next(); }, upload.array('images', 10), createProject);
router.put('/projects/:id',    ...isVendor, updateProject);
router.delete('/projects/:id', ...isVendor, deleteProject);
router.get('/analytics',       ...isVendor, getAnalytics);

module.exports = router;
