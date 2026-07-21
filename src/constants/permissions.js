// Fixed set of admin permission keys, one per gated admin section. Both the
// route middleware (requirePermission) and the admin-user management
// endpoints (which must validate any adminPermissions array submitted by a
// super admin) import this list rather than duplicating it.
const PERMISSION_KEYS = [
  'manage_vendors',
  'manage_leads',
  'manage_users',
  'view_analytics',
  'manage_blog',
  'manage_coupons',
  'manage_support',
  'manage_email_templates',
  'manage_settings',
  'manage_taxonomy',
  'manage_portfolio',
];

module.exports = { PERMISSION_KEYS };
