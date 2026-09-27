const mongoose = require('mongoose');

// The 12 service categories from the SEO team's structured-data spec —
// the URL-hierarchy taxonomy (interior-designers, architects, ...), each
// mapped to a schema.org business type. Deliberately a separate model from
// Category.model.js: that one already backs the live, admin-managed
// specialization taxonomy powering the vendor search/profile picker
// (Modular Kitchen, Commercial, ...), which is a different concept with a
// different shape. See scripts/seedCategoryTaxonomy.js.
const serviceCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9]+(-[a-z0-9]+)*$/,
    },
    schemaOrgType: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ServiceCategory', serviceCategorySchema);
