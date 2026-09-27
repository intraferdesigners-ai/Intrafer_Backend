const CityFAQ = require('../models/CityFAQ.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const { resolveCategory, resolveState, resolvePlaceInState } = require('../utils/resolveTaxonomy');

// Real FAQ content for one category+state+city combo — the
// /[category]/[state]/[city]/ page only renders an FAQ section/FAQPage
// block when this returns non-null content, never a fallback/generic one.
// Returns { faq: null } (200, not an error) when nothing's been authored
// yet for a real category+state+city combo — that's the expected default
// today, since no admin UI or seed data exists for this yet.
const getCityFAQ = catchAsync(async (req, res) => {
  const { category, state, city } = req.query;
  if (!category || !state || !city) return error(res, 'category, state and city are required.', 400);

  const serviceCategory = await resolveCategory(category);
  if (!serviceCategory) return error(res, 'Category not found.', 404);

  const matchedState = await resolveState(state);
  if (!matchedState) return error(res, 'State not found.', 404);

  const matchedPlace = await resolvePlaceInState(city, matchedState);
  if (!matchedPlace) return error(res, 'City not found.', 404);

  const doc = await CityFAQ.findOne({
    category: serviceCategory._id,
    state: matchedState,
    city: matchedPlace.name,
  }).select('questions');

  return success(res, { faq: doc && doc.questions.length > 0 ? { questions: doc.questions } : null });
});

module.exports = { getCityFAQ };
