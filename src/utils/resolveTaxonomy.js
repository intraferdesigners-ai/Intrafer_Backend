// Shared category/state/city slug resolution for the SEO taxonomy chain
// (steps 3-5 of the SEO restructuring project) — turns URL slugs back into
// real ServiceCategory/Place documents, using the same slugify() logic
// (slug.js) the frontend used to build the links in the first place.
// Returns null for anything that doesn't resolve, so callers can 404
// consistently. Used by this step's new call sites (the extended
// getVendors, cityFAQ.controller.js); place.controller.js's existing
// getCategoryCities predates this helper and keeps its own inline copy
// rather than being refactored as a side effect of this step.
const Place = require('../models/Place.model');
const ServiceCategory = require('../models/ServiceCategory.model');
const { slugify } = require('./slug');

async function resolveCategory(categorySlug) {
  return ServiceCategory.findOne({ slug: categorySlug, isActive: true });
}

async function resolveState(stateSlug) {
  const distinctStates = await Place.distinct('state');
  return distinctStates.find((s) => slugify(s) === stateSlug) || null;
}

async function resolvePlaceInState(citySlug, stateName) {
  const places = await Place.find({ state: stateName }).select('name');
  return places.find((p) => slugify(p.name) === citySlug) || null;
}

module.exports = { resolveCategory, resolveState, resolvePlaceInState };
