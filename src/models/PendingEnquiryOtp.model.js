const mongoose = require('mongoose');

// Backs the anonymous "Submit enquiry" OTP step (see enquiry.controller.js).
// Deliberately not the User collection — a guest enquiry must never become a
// loginable account, so this holds nothing but what's needed to verify the
// code and carry the enquirer's details into the Lead once verified.
// TTL-indexed on createdAt so a record disappears on its own shortly after
// the OTP itself has expired, rather than accumulating names/emails/phones
// indefinitely for enquiries that were never completed.
const pendingEnquiryOtpSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    code: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

pendingEnquiryOtpSchema.index({ email: 1 });
pendingEnquiryOtpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 20 * 60 });

module.exports = mongoose.model('PendingEnquiryOtp', pendingEnquiryOtpSchema);
