const { error } = require('../utils/apiResponse');

const rbac = (...roles) => (req, res, next) => {
  if (roles.includes(req.user.role)) return next();
  return error(res, `Access denied. Required role: ${roles.join(' or ')}`, 403);
};

module.exports = rbac;
