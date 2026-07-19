const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    startingPrice: { type: Number },
    priceUnit: { type: String, enum: ['flat', 'per_sqft', 'per_room'], default: 'flat' },
  },
  { _id: false }
);

const vendorSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    businessName: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    specializations: [{ type: String }],
    services: [serviceSchema],
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
    availability: {
      workingDays: [{ type: String, enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }],
      startTime: { type: String, default: '10:00' },
      endTime: { type: String, default: '18:00' },
      slotDurationMinutes: { type: Number, default: 60 },
    },
  },
  { timestamps: true }
);

vendorSchema.index({ 'location.city': 1 });
vendorSchema.index({ specializations: 1 });
vendorSchema.index({ isApproved: 1, isListingEnabled: 1 });

module.exports = mongoose.model('Vendor', vendorSchema);
