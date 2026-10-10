const mongoose = require('mongoose');

// One stored snapshot of a landing page's CONTENT (Phase 4B version
// history): banner, heading, intro, sections, vendorList, seo — already
// sanitised, as saved. Never location, slugs or status: restoring a
// version can't move a page or change whether it's live. `kind` records
// what produced it. The newest MAX_VERSIONS per page are kept (see
// services/landingPageVersion.service.js).
const KINDS = ['create', 'save', 'publish', 'unpublish', 'restore', 'duplicate', 'bulk_create'];

const landingPageVersionSchema = new mongoose.Schema(
  {
    page: { type: mongoose.Schema.Types.ObjectId, ref: 'LandingPage', required: true, index: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    kind: { type: String, enum: KINDS, required: true },
    changedFields: { type: [String], default: [] },
    restoredFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'LandingPageVersion', default: null },
    savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

landingPageVersionSchema.index({ page: 1, createdAt: -1 });

module.exports = mongoose.model('LandingPageVersion', landingPageVersionSchema);
module.exports.KINDS = KINDS;
