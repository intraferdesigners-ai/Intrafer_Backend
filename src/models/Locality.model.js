const mongoose = require('mongoose');

// A post-office/area name within a Place (e.g. "Dwarka", "Rohini", "Karol
// Bagh" under Delhi) — see scripts/seedLocalities.js.
const localitySchema = new mongoose.Schema(
  {
    placeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Place', required: true },
    name: { type: String, required: true, trim: true },
    nameLower: { type: String, required: true }, // lowercase, for indexed prefix search
    pincode: { type: String },
    // Common misspellings/colloquial variants of this locality's name (e.g.
    // "Vashali" for "Vaishali") — same purpose as Place.aliases, but scoped
    // to a single locality since misspellings rarely apply to every locality
    // sharing that word. See LOCALITY_ALIAS_MAP in scripts/seedLocalities.js.
    aliases: { type: [String], default: [] },
  },
  { timestamps: true }
);

localitySchema.index({ placeId: 1, nameLower: 1 });
// Standalone index for the cross-place fallback search in place.controller.js
// (searches localities globally when a query doesn't match any Place —
// e.g. "Manali" or "Noida", which are towns/localities, not districts).
localitySchema.index({ nameLower: 1 });
localitySchema.index({ aliases: 1 });
// Vendor profile's pincode-autofill (place.controller.js's lookupPincode)
// looks up a Locality by exact pincode to resolve its parent Place's
// city/state — indexed since pincode isn't unique per-Locality but is
// looked up on every keystroke-settled pincode entry.
localitySchema.index({ pincode: 1 });

module.exports = mongoose.model('Locality', localitySchema);
