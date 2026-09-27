const mongoose = require('mongoose');

// Real FAQ content for one category+state+city combo (SEO restructuring,
// step 5's /[category]/[state]/[city]/ page) — rendered as a visible FAQ
// section plus FAQPage JSON-LD only when a matching document exists. No
// admin UI to manage these yet (that's a later step) and nothing seeds
// fake content here — a city page with no CityFAQ doc simply renders
// without an FAQ section.
const questionSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const cityFAQSchema = new mongoose.Schema(
  {
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCategory', required: true },
    // Real display name/casing, same as ServiceCategory-scoped endpoints
    // (getCategoryCities, the extended getVendors) already return —
    // not a slug, so this reads naturally if ever surfaced in an admin UI.
    state: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    questions: { type: [questionSchema], default: [] },
  },
  { timestamps: true }
);

cityFAQSchema.index({ category: 1, state: 1, city: 1 }, { unique: true });

module.exports = mongoose.model('CityFAQ', cityFAQSchema);
