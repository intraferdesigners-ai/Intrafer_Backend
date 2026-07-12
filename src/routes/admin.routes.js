const express = require('express');
const {
  getVendors, approveVendor, toggleFeatured,
  getLeads, reassignLead,
  getAnalytics, getUsers, toggleBlockUser,
  getAdminProfile, updateAdminProfile, changePassword,
  getSettings, updateSettings,
} = require('../controllers/admin.controller');
const { protect } = require('../middleware/auth');
const rbac = require('../middleware/rbac');

const router = express.Router();

const isAdmin = [protect, rbac('admin')];

router.get('/vendors',                ...isAdmin, getVendors);
router.put('/vendors/:id/approve',    ...isAdmin, approveVendor);
router.put('/vendors/:id/feature',    ...isAdmin, toggleFeatured);
router.get('/leads',                  ...isAdmin, getLeads);
router.put('/leads/:id/reassign',     ...isAdmin, reassignLead);
router.get('/analytics',              ...isAdmin, getAnalytics);
router.get('/users',                  ...isAdmin, getUsers);
router.put('/users/:id/block',        ...isAdmin, toggleBlockUser);
router.get('/profile',                ...isAdmin, getAdminProfile);
router.put('/profile',                ...isAdmin, updateAdminProfile);
router.put('/change-password',        ...isAdmin, changePassword);
router.get('/settings',               ...isAdmin, getSettings);
router.put('/settings',               ...isAdmin, updateSettings);

module.exports = router;
