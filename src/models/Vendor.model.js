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

// Additional cities/areas a vendor is willing to take on projects in — kept
// separate from `location` below (the vendor's own studio/business address,
// singular). A vendor's real office is one place; where they'll actually go
// serve clients is a list. `placeId` links back to the Place taxonomy when
// the city was resolved via pincode autofill or CitySelect, so the
// vendor-coverage search (searchVendorCities in place.controller.js) can
// match it directly — left unset for a freely-typed city with no match,
// same "custom entry is fine" allowance CitySelect already has elsewhere.
const serviceLocationSchema = new mongoose.Schema(
  {
    placeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Place' },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, trim: true },
  },
  { timestamps: true }
);

const vendorSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    businessName: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    // Public-facing business contact — distinct from the account's own
    // email/phone (User.email/phone, used for login + account notices). A
    // vendor may want customers reaching a different number/inbox than the
    // one they log in with. Blank means "use the account's own email/phone"
    // (see getProfile below and the WhatsApp button on the public vendor
    // page), never a fallback baked into a default here, so it stays
    // correct if the account's own email/phone later changes.
    businessPhone: { type: String, default: '', trim: true },
    businessEmail: { type: String, default: '', trim: true, lowercase: true },
    specializations: [{ type: String }],
    experienceYears: { type: Number, default: null },
    services: [serviceSchema],
    location: {
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      pincode: { type: String },
      lat: { type: Number },
      lng: { type: Number },
    },
    serviceLocations: { type: [serviceLocationSchema], default: [] },
    profilePhoto:    { type: String, default: '' },
    portfolioImages: [{ type: String }],
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 },
    // Subscription (isListingEnabled) is the only pre-listing gate now —
    // vendors go live automatically. isApproved/approvalStatus default to
    // true/'approved' and only get flipped false/'rejected' as a post-hoc
    // admin takedown of an already-live vendor (bad actor, policy violation,
    // etc.), not as a review queue a new vendor waits in. Both fields are
    // left in place unchanged since public.controller.js's listing queries
    // still check them — that's what makes the takedown actually work.
    isApproved: { type: Boolean, default: true },
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, default: '' },
    isListingEnabled: { type: Boolean, default: false },
    isFeatured: { type: Boolean, default: false },
    // One-time-send guard for the stalled-onboarding nudge (see
    // jobs/onboardingNudge.job.js) — set the first time the nudge fires so a
    // vendor stuck in that state doesn't get emailed again every day.
    onboardingNudgeSentAt: { type: Date, default: null },
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
vendorSchema.index({ 'serviceLocations.placeId': 1 });

module.exports = mongoose.model('Vendor', vendorSchema);
