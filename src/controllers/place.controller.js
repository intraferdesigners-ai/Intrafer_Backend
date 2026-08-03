const Place = require('../models/Place.model');
const Locality = require('../models/Locality.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MAX_RESULTS = 20;

// Towns that are colloquially "Delhi" to most people despite sitting in a
// different state/district (Ghaziabad and Gautam Buddha Nagar, UP) — surfaced
// alongside the Delhi Place itself so NCR satellite towns aren't a dead end
// for someone who just searches "Delhi". Keyed by exact Place name.
const DELHI_NCR_SATELLITES = ['Ghaziabad', 'Gautam Buddha Nagar'];
// Minimum query length before the NCR satellites are appended, so a bare
// "d"/"de" (which also prefix-matches Delhi) doesn't drag in Ghaziabad and
// Gautam Buddha Nagar for every unrelated D-place search.
const NCR_TRIGGER_MIN_LENGTH = 3;

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

  // "Delhi" colloquially includes its NCR satellite towns even though
  // they're a different state/district — append those Places once "Delhi"
  // itself is a plausible match, same visibility as a direct name hit.
  if (q.length >= NCR_TRIGGER_MIN_LENGTH && 'delhi'.startsWith(q) && results.length < limit) {
    const alreadyShownIds = results.map((p) => p._id);
    const ncrPlaces = await Place.find({
      name: { $in: DELHI_NCR_SATELLITES },
      _id: { $nin: alreadyShownIds },
    }).sort({ name: 1 });
    results = results.concat(ncrPlaces.slice(0, limit - results.length));
  }

  // Fallback: many well-known towns (Manali, Noida, Mangalore...) aren't
  // districts in their own right, so they only exist as Localities nested
  // under their parent district's Place — a district-only search never
  // finds them even though the data is there. Once Place matches run out,
  // search Localities globally and surface the best few, each labeled with
  // its parent place so it's clear it's a town within a larger district
  // (e.g. "Manali" — "Kullu, Himachal Pradesh"). Selecting one stores the
  // town's own name, which is more precise than forcing a pick of the
  // (possibly unfamiliar) parent district anyway.
  if (results.length < limit) {
    const remaining = limit - results.length;
    const placeIdsAlreadyShown = results.map((p) => p._id);

    // Aliases (e.g. "Vashali" -> Vaishali) match at prefix rank too, same
    // treatment as Place aliases above.
    const localityPrefix = await Locality.find({
      $or: [{ nameLower: { $regex: `^${escaped}` } }, { aliases: { $regex: `^${escaped}` } }],
    })
      .sort({ name: 1 })
      .limit(remaining)
      .populate('placeId', 'name state');

    let localityMatches = localityPrefix;
    if (localityMatches.length < remaining) {
      const excludeLocalityIds = localityMatches.map((l) => l._id);
      const localitySubstring = await Locality.find({
        _id: { $nin: excludeLocalityIds },
        $or: [{ nameLower: { $regex: escaped } }, { aliases: { $regex: escaped } }],
      })
        .sort({ name: 1 })
        .limit(remaining - localityMatches.length)
        .populate('placeId', 'name state');
      localityMatches = localityMatches.concat(localitySubstring);
    }

    const localityAsPlace = localityMatches
      .filter((l) => l.placeId && !placeIdsAlreadyShown.some((id) => id.equals(l.placeId._id)))
      .map((l) => ({
        _id: l._id,
        name: l.name,
        state: l.placeId ? `${l.placeId.name}, ${l.placeId.state}` : '',
        isLocality: true,
      }));

    results = results.concat(localityAsPlace);
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
  const prefixMatches = await Locality.find({
    placeId,
    $or: [{ nameLower: { $regex: `^${escaped}` } }, { aliases: { $regex: `^${escaped}` } }],
  })
    .sort({ name: 1 })
    .limit(limit);

  let results = prefixMatches;
  if (results.length < limit) {
    const excludeIds = results.map((l) => l._id);
    const substringMatches = await Locality.find({
      placeId,
      _id: { $nin: excludeIds },
      $or: [{ nameLower: { $regex: escaped } }, { aliases: { $regex: escaped } }],
    })
      .sort({ name: 1 })
      .limit(limit - results.length);
    results = results.concat(substringMatches);
  }

  return success(res, { localities: results });
});

module.exports = { searchPlaces, searchLocalities };
