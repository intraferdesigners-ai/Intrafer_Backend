const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    businessName: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    specializations: [{ type: String }],
    location: {
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      pincode: { type: String },
      lat: { type: Number },
      lng: { type: Number },
    },
    profilePhoto:    { type: String, default: '' },
    portfolioImages: [{ type: String }],
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 },
    isApproved: { type: Boolean, default: false },
    rejectionReason: { type: String, default: '' },
    isListingEnabled: { type: Boolean, default: false },
    isFeatured: { type: Boolean, default: false },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' },
    totalLeads: { type: Number, default: 0 },
    wonLeads:     { type: Number, default: 0 },
    profileViews: { type: Number, default: 0 },
  },
  { timestamps: true }
);

vendorSchema.index({ 'location.city': 1 });
vendorSchema.index({ specializations: 1 });
vendorSchema.index({ isApproved: 1, isListingEnabled: 1 });

module.exports = mongoose.model('Vendor', vendorSchema);
