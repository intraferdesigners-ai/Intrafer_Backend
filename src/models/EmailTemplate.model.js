const mongoose = require('mongoose');

const TEMPLATE_KEYS = [
  'otp_verification',
  'lead_assigned',
  'subscription_confirm',
  'vendor_approved',
  'vendor_rejected',
  'password_reset',
  'support_ticket_confirmation',
];

const emailTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, enum: TEMPLATE_KEYS },
    name: { type: String, required: true },
    subject: { type: String, required: true },
    htmlBody: { type: String, required: true },
    availableVariables: [{ type: String }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);
