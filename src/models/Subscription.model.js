const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    planName: { type: String, required: true },
    planPrice: { type: Number, required: true },
    leadsPerMonth: { type: Number, required: true },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    status: {
      type: String,
      enum: ['pending', 'active', 'expired', 'cancelled', 'failed'],
      default: 'pending',
    },
    startDate: { type: Date },
    endDate: { type: Date },
    invoiceNumber: { type: String, unique: true, sparse: true },
    couponCode: { type: String, default: '' },
    discountAmount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

subscriptionSchema.index({ vendorId: 1 });
subscriptionSchema.index({ status: 1, endDate: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
