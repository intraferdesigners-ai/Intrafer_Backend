const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    leadId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Lead',   required: true, unique: true },
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    rating:   { type: Number, required: true, min: 1, max: 5 },
    comment:  { type: String, default: '' },
  },
  { timestamps: true }
);

reviewSchema.index({ vendorId: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
