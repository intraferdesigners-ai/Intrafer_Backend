const mongoose = require('mongoose');

// A real Indian city/town, sourced from the Department of Posts' All India
// Pincode Directory (see scripts/seedLocalities.js). Distinct from City.model
// — that's the small admin-curated list surfaced in the admin dashboard;
// this is the full ~700+ entry dataset backing CitySelect's search-as-you-type.
const placeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameLower: { type: String, required: true }, // lowercase, for indexed prefix search
    state: { type: String, required: true, trim: true },
    localityCount: { type: Number, default: 0 },
    // Well-known colloquial/former names (e.g. "Bangalore" for Bengaluru,
    // "Bombay" for Mumbai) — India Post's directory only uses current
    // official names, so these are searched against but not shown as the
    // primary label. See ALIAS_MAP in scripts/seedLocalities.js.
    aliases: { type: [String], default: [] },
  },
  { timestamps: true }
);

placeSchema.index({ nameLower: 1 });
placeSchema.index({ aliases: 1 });
placeSchema.index({ name: 1, state: 1 }, { unique: true });

module.exports = mongoose.model('Place', placeSchema);
