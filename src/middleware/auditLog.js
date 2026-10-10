const AuditLog = require('../models/AuditLog.model');

// Wraps a route with fire-and-forget audit logging. Attaches to res.on('finish')
// so it never delays or can fail the actual request — a logging error is only
// ever console.error'd, never propagated.
//
// A handler may set res.locals.auditDetails (stored as `details`) or
// res.locals.skipAudit (e.g. a read-only dry run on a POST route).
const auditLog = (actionLabel) => (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.user || res.locals.skipAudit) return;

    AuditLog.create({
      adminId:    req.user._id,
      adminName:  req.user.name,
      adminEmail: req.user.email,
      action:     actionLabel,
      method:     req.method,
      path:       req.originalUrl,
      targetId:   req.params.id || null,
      statusCode: res.statusCode,
      ip:         req.ip,
      ...(res.locals.auditDetails && { details: res.locals.auditDetails }),
    }).catch((err) => console.error('Audit log failed:', err));
  });

  next();
};

module.exports = auditLog;
