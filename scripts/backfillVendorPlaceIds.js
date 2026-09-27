// Step 2 of the SEO restructuring project: resolves Vendor.location.city and
// Vendor.serviceLocations[].city (free text, with real inconsistencies —
// "Noida" vs "noida" vs "Gautam Buddha Nagar", "Gaziabad" typo for
// "Ghaziabad", "Bangalore" vs "Bengaluru", ...) against the Place taxonomy,
// the same ~700+ city/town dataset backing CitySelect.
//
// Matching mirrors searchPlaces in src/controllers/place.controller.js
// (nameLower/aliases, prefix match first, substring fallback), reimplemented
// here rather than imported so this one-off script doesn't need to touch
// that controller. Keep the two in sync by hand if searchPlaces' matching
// rules ever change.
//
// A city resolves only when the matching pipeline settles on exactly one
// Place:
//   1. Prefix match against Place.nameLower/aliases.
//   2. If none, substring match against Place.nameLower/aliases.
//   3. If still none, fall back to Locality.nameLower/aliases (same
//      prefix-then-substring order) and use the matched locality's parent
//      Place — this is what resolves "Noida" (a Locality under Gautam
//      Buddha Nagar, not a Place in its own right) to the same Place as
//      someone who entered "Gautam Buddha Nagar" directly.
// Zero matches or multiple distinct Places at whichever stage produces a
// hit are left unresolved and logged — never guessed, never used to create
// a new Place.
//
// Idempotent: only touches location/serviceLocations entries where placeId
// is currently unset (null or missing).
//
// Usage:
//   node scripts/backfillVendorPlaceIds.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Vendor = require('../src/models/Vendor.model');
const Place = require('../src/models/Place.model');
const Locality = require('../src/models/Locality.model');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Resolves a raw city string to a single Place _id, or null if it doesn't
// resolve to exactly one confident match. See file header for the pipeline.
async function resolveCityToPlaceId(rawCity) {
  const q = (rawCity || '').trim().toLowerCase();
  if (!q) return { status: 'empty' };

  const escaped = escapeRegex(q);

  const placePrefix = await Place.find({
    $or: [{ nameLower: { $regex: `^${escaped}` } }, { aliases: { $regex: `^${escaped}` } }],
  }).select('_id');
  if (placePrefix.length === 1) return { status: 'resolved', placeId: placePrefix[0]._id };
  if (placePrefix.length > 1) return { status: 'ambiguous' };

  const placeSubstring = await Place.find({
    $or: [{ nameLower: { $regex: escaped } }, { aliases: { $regex: escaped } }],
  }).select('_id');
  if (placeSubstring.length === 1) return { status: 'resolved', placeId: placeSubstring[0]._id };
  if (placeSubstring.length > 1) return { status: 'ambiguous' };

  const localityPrefix = await Locality.find({
    $or: [{ nameLower: { $regex: `^${escaped}` } }, { aliases: { $regex: `^${escaped}` } }],
  }).select('placeId');
  let localityMatches = localityPrefix;
  if (localityMatches.length === 0) {
    localityMatches = await Locality.find({
      $or: [{ nameLower: { $regex: escaped } }, { aliases: { $regex: escaped } }],
    }).select('placeId');
  }

  const distinctPlaceIds = [...new Set(localityMatches.map((l) => String(l.placeId)))];
  if (distinctPlaceIds.length === 1) return { status: 'resolved', placeId: localityMatches[0].placeId };
  if (distinctPlaceIds.length > 1) return { status: 'ambiguous' };

  return { status: 'not_found' };
}

async function backfill() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const vendors = await Vendor.find({});
  console.log(`Found ${vendors.length} vendor(s) total.`);

  let locationResolved = 0;
  let serviceLocationResolved = 0;
  let skippedAlreadySet = 0;
  const unresolved = [];

  for (const vendor of vendors) {
    let dirty = false;

    if (!vendor.location?.placeId) {
      const result = await resolveCityToPlaceId(vendor.location?.city);
      if (result.status === 'resolved') {
        vendor.location.placeId = result.placeId;
        dirty = true;
        locationResolved += 1;
      } else if (result.status !== 'empty') {
        unresolved.push({
          vendorId: String(vendor._id),
          businessName: vendor.businessName,
          field: 'location.city',
          city: vendor.location?.city,
          reason: result.status,
        });
      }
    }

    for (const sl of vendor.serviceLocations || []) {
      if (sl.placeId) {
        skippedAlreadySet += 1;
        continue;
      }
      const result = await resolveCityToPlaceId(sl.city);
      if (result.status === 'resolved') {
        sl.placeId = result.placeId;
        dirty = true;
        serviceLocationResolved += 1;
      } else if (result.status !== 'empty') {
        unresolved.push({
          vendorId: String(vendor._id),
          businessName: vendor.businessName,
          field: 'serviceLocations',
          city: sl.city,
          reason: result.status,
        });
      }
    }

    if (dirty) {
      await vendor.save();
    }
  }

  console.log('---');
  console.log(`location.city resolved:        ${locationResolved}`);
  console.log(`serviceLocations city resolved: ${serviceLocationResolved}`);
  console.log(`serviceLocations already set:   ${skippedAlreadySet}`);
  console.log(`Unresolved:                     ${unresolved.length}`);
  if (unresolved.length) {
    console.log('\nUnresolved entries (manual follow-up):');
    unresolved.forEach((u) => {
      console.log(`  [${u.reason}] ${u.businessName} (${u.vendorId}) — ${u.field}: "${u.city}"`);
    });
  }

  await mongoose.disconnect();
  process.exit(0);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
