const Place = require('../models/Place.model');
const Locality = require('../models/Locality.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MAX_RESULTS = 20;

// Search-as-you-type over the ~740-place dataset (see scripts/seedLocalities.js).
// Prefix matches (indexed, via nameLower) rank above substring matches, same
// two-pass approach CitySelect used to do client-side against the old
// hardcoded 62-city list.
const searchPlaces = catchAsync(async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  const limit = Math.min(parseInt(req.query.limit, 10) || 8, MAX_RESULTS);

  if (!q) {
    const places = await Place.find().sort({ name: 1 }).limit(limit);
    return success(res, { places });
  }

  const escaped = escapeRegex(q);
  // Aliases (e.g. "Bangalore" -> Bengaluru) match at prefix rank too — a
  // colloquial-name hit is just as strong a signal as a name prefix hit.
  const prefixMatches = await Place.find({
    $or: [{ nameLower: { $regex: `^${escaped}` } }, { aliases: { $regex: `^${escaped}` } }],
  })
    .sort({ name: 1 })
    .limit(limit);

  let results = prefixMatches;
  if (results.length < limit) {
    const excludeIds = results.map((p) => p._id);
    const substringMatches = await Place.find({
      _id: { $nin: excludeIds },
      $or: [{ nameLower: { $regex: escaped } }, { aliases: { $regex: escaped } }],
    })
      .sort({ name: 1 })
      .limit(limit - results.length);
    results = results.concat(substringMatches);
  }

  return success(res, { places: results });
});

// Localities are scoped to a single place — used as the optional secondary
// step once a city is chosen (see CitySelect.jsx / LocalitySelect.jsx).
const searchLocalities = catchAsync(async (req, res) => {
  const { placeId } = req.params;
  const q = (req.query.q || '').trim().toLowerCase();
  const limit = Math.min(parseInt(req.query.limit, 10) || 8, MAX_RESULTS);

  const place = await Place.findById(placeId);
  if (!place) return error(res, 'Place not found.', 404);

  if (!q) {
    const localities = await Locality.find({ placeId }).sort({ name: 1 }).limit(limit);
    return success(res, { localities });
  }

  const escaped = escapeRegex(q);
  const prefixMatches = await Locality.find({ placeId, nameLower: { $regex: `^${escaped}` } })
    .sort({ name: 1 })
    .limit(limit);

  let results = prefixMatches;
  if (results.length < limit) {
    const excludeIds = results.map((l) => l._id);
    const substringMatches = await Locality.find({
      placeId,
      _id: { $nin: excludeIds },
      nameLower: { $regex: escaped },
    })
      .sort({ name: 1 })
      .limit(limit - results.length);
    results = results.concat(substringMatches);
  }

  return success(res, { localities: results });
});

module.exports = { searchPlaces, searchLocalities };
