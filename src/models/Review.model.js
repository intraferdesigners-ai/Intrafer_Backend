const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    leadId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Lead',   required: true, unique: true },
    // No longer set for new reviews — submitted via the emailed review-link
    // token (see review.controller.js), which authenticates against the
    // guest enquirer's Lead contact fields, not a logged-in User. leadId is
    // now the anchor (it was already unique: true, i.e. already 1:1 with a
    // Lead). Left optional rather than removed so pre-removal reviews from a
    // real logged-in homeowner keep their author on record; getVendorReviews
    // and the public reviews endpoint fall back to it for that legacy data.
    // See the homeowner-removal plan, Phase 0/7.
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    rating:   { type: Number, required: true, min: 1, max: 5 },
    comment:  { type: String, default: '' },
  },
  { timestamps: true }
);

reviewSchema.index({ vendorId: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
