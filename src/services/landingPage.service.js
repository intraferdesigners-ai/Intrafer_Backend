const Vendor = require('../models/Vendor.model');
const Place = require('../models/Place.model');
const { resolveState, resolvePlaceInState } = require('../utils/resolveTaxonomy');
const { meetsIndexThreshold } = require('../utils/indexThreshold');
const { slugify } = require('../utils/slug');

// Same listing gate as GET /public/vendors.
const LISTED = { isApproved: true, isListingEnabled: true };

const VENDOR_SORT = {
  featured: { isFeatured: -1, rating: -1 },
  rating:   { rating: -1 },
  newest:   { createdAt: -1 },
};

// A Mongo regex matching any string whose slugify() equals `slug` —
// case-insensitive, separator-tolerant, anchored. This is the same
// tolerance resolveState() applies to state names ("Uttar Pradesh",
// "uttar pradesh" and "uttar-pradesh" all match), done in the query so
// count/sort/limit stay in the database.
function slugRegex(slug) {
  const parts = slug.split('-').filter(Boolean);
  return new RegExp(`^[^a-z0-9]*${parts.join('[^a-z0-9]+')}[^a-z0-9]*$`, 'i');
}

// Exactly getVendors' category+state+city branch: Place-resolved match.
async function resolvePlace(stateSlug, citySlug) {
  const stateName = await resolveState(stateSlug);
  if (!stateName) return null;
  return resolvePlaceInState(citySlug, stateName);
}

function placeFilter(categoryId, placeId) {
  return {
    ...LISTED,
    primaryCategory: categoryId,
    $or: [
      { 'location.placeId': placeId },
      { 'serviceLocations.placeId': placeId },
    ],
  };
}

// Fallback for a city that doesn't resolve to a Place: matches the
// vendor's free-text city/state, pairwise (a serviceLocations entry must
// match city AND state in the same entry).
function nameFilter(categoryId, stateSlug, citySlug) {
  const stateRe = slugRegex(stateSlug);
  const cityRe = slugRegex(citySlug);
  return {
    ...LISTED,
    primaryCategory: categoryId,
    $or: [
      { 'location.city': cityRe, 'location.state': stateRe },
      { serviceLocations: { $elemMatch: { city: cityRe, state: stateRe } } },
    ],
  };
}

// Place resolution first, name match only when the city doesn't resolve.
async function buildVendorFilter(categoryId, stateSlug, citySlug) {
  const matchedPlace = await resolvePlace(stateSlug, citySlug);
  if (matchedPlace) {
    return { filter: placeFilter(categoryId, matchedPlace._id), matchedPlace, matchedBy: 'place' };
  }
  return { filter: nameFilter(categoryId, stateSlug, citySlug), matchedPlace: null, matchedBy: 'name' };
}

// seo.indexing is the single source of truth for a landing page's
// indexability: forced either way, or the shared vendor-count threshold.
function computeIndexable(indexing, vendorCount) {
  if (indexing === 'index') return true;
  if (indexing === 'noindex') return false;
  return meetsIndexThreshold(vendorCount);
}

// Alias-aware variant used ONLY for match-check's "probably the same city"
// detection — "Bangalore" should be flagged as the same city as an
// existing "Bengaluru" page (Place.aliases holds colloquial/former
// names). The public endpoint deliberately keeps using the stricter
// resolvePlace() above, same as GET /public/vendors.
async function resolvePlaceWithAliases(stateSlug, citySlug) {
  const stateName = await resolveState(stateSlug);
  if (!stateName) return null;
  const places = await Place.find({ state: stateName }).select('name aliases');
  return places.find((p) => slugify(p.name) === citySlug)
    || places.find((p) => (p.aliases || []).some((a) => slugify(a) === citySlug))
    || null;
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function isSimilarSlug(a, b) {
  if (!a || !b) return false;
  return editDistance(a, b) <= 2 || a.includes(b) || b.includes(a);
}

module.exports = {
  VENDOR_SORT,
  buildVendorFilter,
  placeFilter,
  nameFilter,
  computeIndexable,
  resolvePlaceWithAliases,
  isSimilarSlug,
  editDistance,
};
