const mongoose = require('mongoose');

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, default: '' },
  },
  { _id: false }
);

const leadSchema = new mongoose.Schema(
  {
    enquiryId: { type: String, required: true, unique: true },
    // No longer required — guest enquiries (see enquiry.controller.js) never
    // create a User, so a Lead now stands on its own via the contactName/
    // contactEmail/contactPhone fields below. Still set (and still the
    // source of truth for messaging/review authorship) for leads submitted
    // by a logged-in homeowner account.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    contactName: { type: String, default: '' },
    contactEmail: { type: String, default: '', lowercase: true, trim: true },
    contactPhone: { type: String, default: '', trim: true },
    projectType: { type: String, default: '' },
    budget: { type: String, default: '' },
    city: { type: String, required: true },
    requirements: { type: String, default: '' },
    status: {
      type: String,
      enum: ['new', 'accepted', 'won', 'lost', 'cancelled'],
      default: 'new',
    },
    contactRevealedAt: { type: Date },
    statusHistory: [statusHistorySchema],
    vendorNotes: { type: String, default: '' },
    isConsultation: { type: Boolean, default: false },
    preferredDate: { type: String, default: '' },
    confirmedDateTime: { type: Date, default: null },
    // Set when status flips to 'won' (see updateLeadStatus) so the enquirer
    // can leave a review via emailed link instead of a login session — guest
    // enquirers have no account to log into. Same hash-and-expire shape as
    // User's passwordResetToken/passwordResetExpires; select: false for the
    // same reason. Cleared once the review is submitted (single-use).
    reviewToken: { type: String, select: false },
    reviewTokenExpiresAt: { type: Date, select: false },
  },
  { timestamps: true }
);

leadSchema.index({ vendorId: 1, status: 1 });
leadSchema.index({ userId: 1 });

module.exports = mongoose.model('Lead', leadSchema);
