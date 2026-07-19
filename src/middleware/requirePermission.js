const { error } = require('../utils/apiResponse');

const requirePermission = (permissionKey) => (req, res, next) => {
  if (req.user.role !== 'admin') {
    return error(res, 'Access denied.', 403);
  }
  if (req.user.isSuperAdmin) {
    return next();
  }
  if (req.user.adminPermissions?.includes(permissionKey)) {
    return next();
  }
  return error(res, "You don't have permission to access this section.", 403);
};

module.exports = requirePermission;
