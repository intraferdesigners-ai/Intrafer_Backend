const express = require('express');
const {
  getVendors, approveVendor, toggleFeatured,
  getLeads, reassignLead,
  getAnalytics, getUsers, toggleBlockUser,
  getAdminProfile, updateAdminProfile, changePassword,
  getSettings, updateSettings,
  getAdminUsers, createAdminUser, updateAdminPermissions,
} = require('../controllers/admin.controller');
const {
  getAllPostsAdmin, createPost, updatePost, deletePost,
} = require('../controllers/blog.controller');
const {
  getAllCoupons, createCoupon, updateCoupon, deleteCoupon,
} = require('../controllers/coupon.controller');
const {
  getAllTickets, updateTicket,
} = require('../controllers/supportTicket.controller');
const {
  getAllTemplates, updateTemplate,
} = require('../controllers/emailTemplate.controller');
const { protect } = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const requirePermission = require('../middleware/requirePermission');
const { error } = require('../utils/apiResponse');

const router = express.Router();

const isAdmin = [protect, rbac('admin')];

// Only an existing super admin may create or reconfigure admin staff — this
// is a hardcoded isSuperAdmin check, deliberately separate from
// requirePermission/adminPermissions (see admin.controller.js for why).
const isSuperAdmin = (req, res, next) =>
  req.user.isSuperAdmin ? next() : error(res, 'Super admin access required.', 403);

router.get('/vendors',                ...isAdmin, requirePermission('manage_vendors'), getVendors);
router.put('/vendors/:id/approve',    ...isAdmin, requirePermission('manage_vendors'), approveVendor);
router.put('/vendors/:id/feature',    ...isAdmin, requirePermission('manage_vendors'), toggleFeatured);
router.get('/leads',                  ...isAdmin, requirePermission('manage_leads'), getLeads);
router.put('/leads/:id/reassign',     ...isAdmin, requirePermission('manage_leads'), reassignLead);
router.get('/analytics',              ...isAdmin, requirePermission('view_analytics'), getAnalytics);
router.get('/users',                  ...isAdmin, requirePermission('manage_users'), getUsers);
router.put('/users/:id/block',        ...isAdmin, requirePermission('manage_users'), toggleBlockUser);
router.get('/profile',                ...isAdmin, getAdminProfile);
router.put('/profile',                ...isAdmin, updateAdminProfile);
router.put('/change-password',        ...isAdmin, changePassword);
router.get('/settings',               ...isAdmin, requirePermission('manage_settings'), getSettings);
router.put('/settings',               ...isAdmin, requirePermission('manage_settings'), updateSettings);
router.get('/blog',                   ...isAdmin, requirePermission('manage_blog'), getAllPostsAdmin);
router.post('/blog',                  ...isAdmin, requirePermission('manage_blog'), createPost);
router.put('/blog/:id',               ...isAdmin, requirePermission('manage_blog'), updatePost);
router.delete('/blog/:id',            ...isAdmin, requirePermission('manage_blog'), deletePost);
router.get('/coupons',                ...isAdmin, requirePermission('manage_coupons'), getAllCoupons);
router.post('/coupons',               ...isAdmin, requirePermission('manage_coupons'), createCoupon);
router.put('/coupons/:id',            ...isAdmin, requirePermission('manage_coupons'), updateCoupon);
router.delete('/coupons/:id',         ...isAdmin, requirePermission('manage_coupons'), deleteCoupon);
router.get('/support-tickets',        ...isAdmin, requirePermission('manage_support'), getAllTickets);
router.put('/support-tickets/:id',    ...isAdmin, requirePermission('manage_support'), updateTicket);
router.get('/email-templates',        ...isAdmin, requirePermission('manage_email_templates'), getAllTemplates);
router.put('/email-templates/:id',    ...isAdmin, requirePermission('manage_email_templates'), updateTemplate);
router.get('/admin-users',            ...isAdmin, isSuperAdmin, getAdminUsers);
router.post('/admin-users',           ...isAdmin, isSuperAdmin, createAdminUser);
router.put('/admin-users/:id/permissions', ...isAdmin, isSuperAdmin, updateAdminPermissions);

module.exports = router;
