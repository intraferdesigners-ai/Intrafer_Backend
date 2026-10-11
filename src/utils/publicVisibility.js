const Vendor = require('../models/Vendor.model');

// What the public site may show. A vendor is visible exactly when the public
// vendor listing/profile would show it; a project only when it is published,
// approved AND its vendor is visible — a suspended or unlisted vendor's
// projects behave as if they didn't exist (404 by id, absent from lists).

const VISIBLE_VENDOR = Object.freeze({ isApproved: true, isListingEnabled: true });
const PUBLIC_PROJECT = Object.freeze({ isPublished: true, moderationStatus: 'approved' });

// One indexed query (isApproved_1_isListingEnabled_1) per request; the ids
// then scope every project query in that request via vendorId: { $in }.
const visibleVendorIds = () => Vendor.distinct('_id', VISIBLE_VENDOR);

// Project filter for list endpoints: `extra` + public project + visible vendor.
async function publicProjectFilter(extra = {}) {
  return { ...extra, ...PUBLIC_PROJECT, vendorId: { $in: await visibleVendorIds() } };
}

// populate() option for single-project reads: the vendor comes back null
// when hidden (or deleted), so the caller can treat the project as missing
// without an extra query.
const visibleVendorPopulate = (select) => ({ path: 'vendorId', select, match: VISIBLE_VENDOR });

module.exports = { VISIBLE_VENDOR, PUBLIC_PROJECT, visibleVendorIds, publicProjectFilter, visibleVendorPopulate };
