const express = require('express');
const {
  getVendors, approveVendor, toggleFeatured,
  getLeads, reassignLead,
  getAnalytics, getUsers, toggleBlockUser,
  getAdminProfile, updateAdminProfile, changePassword,
  getSettings, updateSettings,
  getAdminUsers, createAdminUser, updateAdminPermissions,
  getAuditLogs,
  getRevenueReport, exportRevenueReport,
  getPendingProjects, moderateProject,
  getAllProjects, getAllSubscriptions,
  toggleProjectFeatured,
} = require('../controllers/admin.controller');
const {
  getAllPostsAdmin, createPost, updatePost, deletePost,
} = require('../controllers/blog.controller');
const {
  getAllCoupons, createCoupon, updateCoupon, deleteCoupon,
} = require('../controllers/coupon.controller');
const {
  getCities, createCity, updateCity, deleteCity,
  getCategories, createCategory, updateCategory, deleteCategory,
} = require('../controllers/taxonomy.controller');
const {
  getAllTickets, updateTicket,
} = require('../controllers/supportTicket.controller');
const {
  getAllTemplates, updateTemplate,
} = require('../controllers/emailTemplate.controller');
const { protect } = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const requirePermission = require('../middleware/requirePermission');
const auditLog = require('../middleware/auditLog');
const { error } = require('../utils/apiResponse');

const router = express.Router();

const isAdmin = [protect, rbac('admin')];

// Only an existing super admin may create or reconfigure admin staff — this
// is a hardcoded isSuperAdmin check, deliberately separate from
// requirePermission/adminPermissions (see admin.controller.js for why).
const isSuperAdmin = (req, res, next) =>
  req.user.isSuperAdmin ? next() : error(res, 'Super admin access required.', 403);

router.get('/vendors',                ...isAdmin, requirePermission('manage_vendors'), getVendors);
router.put('/vendors/:id/approve',    ...isAdmin, requirePermission('manage_vendors'), auditLog('Approve/reject vendor'), approveVendor);
router.put('/vendors/:id/feature',    ...isAdmin, requirePermission('manage_vendors'), auditLog('Toggle vendor featured'), toggleFeatured);
router.get('/leads',                  ...isAdmin, requirePermission('manage_leads'), getLeads);
router.put('/leads/:id/reassign',     ...isAdmin, requirePermission('manage_leads'), auditLog('Reassign lead'), reassignLead);
router.get('/analytics',              ...isAdmin, requirePermission('view_analytics'), getAnalytics);
router.get('/users',                  ...isAdmin, requirePermission('manage_users'), getUsers);
router.put('/users/:id/block',        ...isAdmin, requirePermission('manage_users'), auditLog('Block/unblock user'), toggleBlockUser);
router.get('/profile',                ...isAdmin, getAdminProfile);
router.put('/profile',                ...isAdmin, updateAdminProfile);
router.put('/change-password',        ...isAdmin, changePassword);
router.get('/settings',               ...isAdmin, requirePermission('manage_settings'), getSettings);
router.put('/settings',               ...isAdmin, requirePermission('manage_settings'), auditLog('Update site settings'), updateSettings);
router.get('/blog',                   ...isAdmin, requirePermission('manage_blog'), getAllPostsAdmin);
router.post('/blog',                  ...isAdmin, requirePermission('manage_blog'), auditLog('Create blog post'), createPost);
router.put('/blog/:id',               ...isAdmin, requirePermission('manage_blog'), auditLog('Update blog post'), updatePost);
router.delete('/blog/:id',            ...isAdmin, requirePermission('manage_blog'), auditLog('Delete blog post'), deletePost);
router.get('/coupons',                ...isAdmin, requirePermission('manage_coupons'), getAllCoupons);
router.post('/coupons',               ...isAdmin, requirePermission('manage_coupons'), auditLog('Create coupon'), createCoupon);
router.put('/coupons/:id',            ...isAdmin, requirePermission('manage_coupons'), auditLog('Update coupon'), updateCoupon);
router.delete('/coupons/:id',         ...isAdmin, requirePermission('manage_coupons'), auditLog('Delete coupon'), deleteCoupon);
router.get('/cities',                 ...isAdmin, requirePermission('manage_taxonomy'), getCities);
router.post('/cities',                ...isAdmin, requirePermission('manage_taxonomy'), auditLog('Create city'), createCity);
router.put('/cities/:id',             ...isAdmin, requirePermission('manage_taxonomy'), auditLog('Update city'), updateCity);
router.delete('/cities/:id',          ...isAdmin, requirePermission('manage_taxonomy'), auditLog('Delete city'), deleteCity);
router.get('/categories',             ...isAdmin, requirePermission('manage_taxonomy'), getCategories);
router.post('/categories',            ...isAdmin, requirePermission('manage_taxonomy'), auditLog('Create category'), createCategory);
router.put('/categories/:id',         ...isAdmin, requirePermission('manage_taxonomy'), auditLog('Update category'), updateCategory);
router.delete('/categories/:id',      ...isAdmin, requirePermission('manage_taxonomy'), auditLog('Delete category'), deleteCategory);
router.get('/support-tickets',        ...isAdmin, requirePermission('manage_support'), getAllTickets);
router.put('/support-tickets/:id',    ...isAdmin, requirePermission('manage_support'), auditLog('Update support ticket'), updateTicket);
router.get('/email-templates',        ...isAdmin, requirePermission('manage_email_templates'), getAllTemplates);
router.put('/email-templates/:id',    ...isAdmin, requirePermission('manage_email_templates'), auditLog('Update email template'), updateTemplate);
router.get('/admin-users',            ...isAdmin, isSuperAdmin, getAdminUsers);
router.post('/admin-users',           ...isAdmin, isSuperAdmin, auditLog('Create admin user'), createAdminUser);
router.put('/admin-users/:id/permissions', ...isAdmin, isSuperAdmin, auditLog('Update admin permissions'), updateAdminPermissions);
router.get('/audit-logs',             ...isAdmin, isSuperAdmin, getAuditLogs);
router.get('/reports/revenue',        ...isAdmin, requirePermission('view_analytics'), getRevenueReport);
router.get('/reports/revenue/export', ...isAdmin, requirePermission('view_analytics'), exportRevenueReport);
router.get('/projects/pending',       ...isAdmin, requirePermission('manage_portfolio'), getPendingProjects);
router.put('/projects/:id/moderate',  ...isAdmin, requirePermission('manage_portfolio'), auditLog('Approve/reject project'), moderateProject);
router.get('/projects',               ...isAdmin, requirePermission('manage_portfolio'), getAllProjects);
router.get('/subscriptions',          ...isAdmin, requirePermission('view_analytics'), getAllSubscriptions);
router.put('/projects/:id/feature',   ...isAdmin, requirePermission('manage_portfolio'), auditLog('Toggle project featured'), toggleProjectFeatured);

module.exports = router;
