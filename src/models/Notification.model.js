const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipientRole: { type: String, enum: ['user', 'vendor', 'admin'], required: true },
    type: {
      type: String,
      enum: [
        'lead_assigned',
        'lead_accepted',
        'enquiry_created',
        'payment_success',
        'subscription_expiring',
        'vendor_approved',
      ],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    channels: [{ type: String, enum: ['whatsapp', 'email', 'in_app'] }],
    isRead: { type: Boolean, default: false },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

notificationSchema.index({ recipientId: 1, isRead: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
