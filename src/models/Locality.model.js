const mongoose = require('mongoose');

// A post-office/area name within a Place (e.g. "Dwarka", "Rohini", "Karol
// Bagh" under Delhi) — see scripts/seedLocalities.js.
const localitySchema = new mongoose.Schema(
  {
    placeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Place', required: true },
    name: { type: String, required: true, trim: true },
    nameLower: { type: String, required: true }, // lowercase, for indexed prefix search
    pincode: { type: String },
  },
  { timestamps: true }
);

localitySchema.index({ placeId: 1, nameLower: 1 });
// Standalone index for the cross-place fallback search in place.controller.js
// (searches localities globally when a query doesn't match any Place —
// e.g. "Manali" or "Noida", which are towns/localities, not districts).
localitySchema.index({ nameLower: 1 });

module.exports = mongoose.model('Locality', localitySchema);
