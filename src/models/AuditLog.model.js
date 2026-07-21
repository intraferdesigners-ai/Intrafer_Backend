const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    adminId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    adminName:  { type: String, required: true },
    adminEmail: { type: String, required: true },
    action:     { type: String, required: true },
    method:     { type: String, required: true },
    path:       { type: String, required: true },
    targetId:   { type: String, default: null },
    statusCode: { type: Number, required: true },
    ip:         { type: String, default: '' },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
