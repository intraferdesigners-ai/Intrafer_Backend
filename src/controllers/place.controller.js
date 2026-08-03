const Place = require('../models/Place.model');
const Locality = require('../models/Locality.model');
const Vendor = require('../models/Vendor.model');
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

// Pincode -> city/state autofill for the vendor profile's service-locations
// form (see vendor.controller.js / the frontend profile page) — reuses the
// same India Post-derived Locality data searchPlaces/searchLocalities are
// built on, rather than calling any external geocoding API. A pincode maps
// to several Locality rows (one per post office in that area), but they all
// share the same parent Place, so the first match's placeId is authoritative
// regardless of which specific post office record it happens to be.
const lookupPincode = catchAsync(async (req, res) => {
  const { pincode } = req.params;
  if (!/^\d{6}$/.test(pincode)) return error(res, 'Enter a valid 6-digit pincode.', 400);

  const locality = await Locality.findOne({ pincode }).populate('placeId', 'name state');
  if (!locality?.placeId) return error(res, 'No matching city found for this pincode.', 404);

  return success(res, {
    placeId: locality.placeId._id,
    city: locality.placeId.name,
    state: locality.placeId.state,
  });
});

// City search scoped to actual vendor coverage — used by the homepage/sticky
// search widgets instead of searchPlaces' full ~740-place taxonomy, per the
// "don't suggest a city with zero vendors" pivot. A city counts as "covered"
// if at least one live (isApproved + isListingEnabled) vendor lists it in
// serviceLocations; for a vendor with no serviceLocations entries yet (the
// field is new), their single business-address city (`location.city`)
// counts instead, so nobody drops out of search until they fill in the new
// field. Same { places: [...] } response shape as searchPlaces, so
// CitySelect can point at either interchangeably.
const searchVendorCities = catchAsync(async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  const limit = Math.min(parseInt(req.query.limit, 10) || 8, MAX_RESULTS);

  const vendors = await Vendor.find({ isApproved: true, isListingEnabled: true })
    .select('location.city serviceLocations');

  const placeIds = new Set();
  const cityNames = new Set();

  for (const v of vendors) {
    if (v.serviceLocations?.length) {
      for (const loc of v.serviceLocations) {
        if (loc.placeId) placeIds.add(loc.placeId.toString());
        else if (loc.city) cityNames.add(loc.city.trim().toLowerCase());
      }
    } else if (v.location?.city) {
      cityNames.add(v.location.city.trim().toLowerCase());
    }
  }

  // Freely-typed city names (no placeId) have to be resolved against the
  // taxonomy by name before they can be used as an `_id` filter below.
  if (cityNames.size > 0) {
    const namesArr = [...cityNames];
    const nameMatches = await Place.find({
      $or: [{ nameLower: { $in: namesArr } }, { aliases: { $in: namesArr } }],
    }).select('_id');
    nameMatches.forEach((p) => placeIds.add(p._id.toString()));
  }

  if (placeIds.size === 0) return success(res, { places: [] });
  const coveredIds = [...placeIds];

  if (!q) {
    const places = await Place.find({ _id: { $in: coveredIds } }).sort({ name: 1 }).limit(limit);
    return success(res, { places });
  }

  const escaped = escapeRegex(q);
  const prefixMatches = await Place.find({
    _id: { $in: coveredIds },
    $or: [{ nameLower: { $regex: `^${escaped}` } }, { aliases: { $regex: `^${escaped}` } }],
  })
    .sort({ name: 1 })
    .limit(limit);

  let results = prefixMatches;
  if (results.length < limit) {
    const excludeIds = results.map((p) => p._id);
    const substringMatches = await Place.find({
      _id: { $in: coveredIds, $nin: excludeIds },
      $or: [{ nameLower: { $regex: escaped } }, { aliases: { $regex: escaped } }],
    })
      .sort({ name: 1 })
      .limit(limit - results.length);
    results = results.concat(substringMatches);
  }

  return success(res, { places: results });
});

module.exports = { searchPlaces, searchLocalities, lookupPincode, searchVendorCities };
