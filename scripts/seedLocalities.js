// Seeds the Place and Locality collections from the Department of Posts'
// All India Pincode Directory (165,627 post-office records as of the
// 2025-10-03 dataset revision). Run scripts/fetchPincodeData.js first to
// populate scripts/data/pincode-directory-raw.json.
//
// This is a full-refresh seed (clears both collections before inserting),
// not an upsert-skip-if-exists loop like seedTaxonomy.js — that pattern
// suits a small hand-curated list, but re-running per-document find+create
// against ~165k raw rows would be impractically slow, and this dataset is
// meant to be periodically refreshed wholesale from source, not hand-edited.
//
// Grouping: a "Place" (city/town) is the raw `district` field, normalized
// and title-cased, disambiguated by state (a handful of district names
// repeat across states, e.g. Aurangabad in both Maharashtra and Bihar).
// India's district-level directory splits a few major metros into multiple
// administrative districts (Delhi into 11, Mumbai into 2, Bengaluru into 2)
// that nobody searches for separately, so those are merged into one Place
// via METRO_MERGE below. Everything else maps 1:1 with its source district.
//
// Localities are the raw `officename` field (individual post offices),
// deduped per-Place after stripping the trailing office-type suffix
// (S.O / B.O / H.O, in its various spacing/punctuation forms) so they read
// as real place names — e.g. "Dwarka Sec-6 S.O" -> "Dwarka Sec-6".
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const fs = require('fs');
const mongoose = require('mongoose');
const Place = require('../src/models/Place.model');
const Locality = require('../src/models/Locality.model');

const RAW_FILE = path.resolve(__dirname, 'data/pincode-directory-raw.json');

// Source districts that should collapse into one recognizable metro Place,
// keyed as "DISTRICT|STATE" (both upper-cased raw values).
const METRO_MERGE = new Map([
  ['CENTRAL|DELHI', 'Delhi'], ['EAST|DELHI', 'Delhi'], ['NEW DELHI|DELHI', 'Delhi'],
  ['NORTH|DELHI', 'Delhi'], ['NORTH EAST|DELHI', 'Delhi'], ['NORTH WEST|DELHI', 'Delhi'],
  ['SHAHDARA|DELHI', 'Delhi'], ['SOUTH|DELHI', 'Delhi'], ['SOUTH WEST|DELHI', 'Delhi'],
  ['SOUTH EAST|DELHI', 'Delhi'], ['WEST|DELHI', 'Delhi'],
  ['MUMBAI|MAHARASHTRA', 'Mumbai'], ['MUMBAI SUBURBAN|MAHARASHTRA', 'Mumbai'],
  ['BENGALURU URBAN|KARNATAKA', 'Bengaluru'], ['BENGALURU RURAL|KARNATAKA', 'Bengaluru'],
]);

// India Post's directory only carries current official place names, but
// people overwhelmingly still search by the old/colloquial name for these —
// keyed by official Place name (case-insensitive match against `name`).
const ALIAS_MAP = new Map([
  ['Bengaluru', ['Bangalore']],
  ['Mumbai', ['Bombay']],
  ['Kolkata', ['Calcutta']],
  ['Chennai', ['Madras']],
  ['Gurugram', ['Gurgaon']],
  ['Prayagraj', ['Allahabad']],
  ['Thiruvananthapuram', ['Trivandrum']],
  ['Kochi', ['Cochin']],
  ['Vadodara', ['Baroda']],
  ['Pune', ['Poona']],
  ['Puducherry', ['Pondicherry']],
  ['Kozhikode', ['Calicut']],
  ['Mysuru', ['Mysore']],
  ['Varanasi', ['Banaras', 'Benares']],
  ['Shivamogga', ['Shimoga']],
  ['Tumakuru', ['Tumkur']],
  ['Tiruchirappalli', ['Trichy']],
  ['Belagavi', ['Belgaum']],
  // The source dataset itself misspells this district name (missing the
  // "n" -> "Visakhapatanam" instead of "Visakhapatnam") — searching the
  // correctly-spelled name found nothing. Aliased to both the correct
  // spelling and its common short form.
  ['Visakhapatanam', ['Visakhapatnam', 'Vizag']],
  // Navi Mumbai is a well-known planned city, but unlike Noida (which does
  // appear verbatim as a Locality), no raw record's officename contains
  // "Navi Mumbai" at all — it's split across constituent areas (Vashi,
  // Nerul, Kharghar...) under Thane. Aliased to that parent district so the
  // search isn't a dead end, rather than inventing a synthetic locality row.
  ['Thane', ['Navi Mumbai']],
]);

const normSpace = (s) => (s || '').replace(/\s+/g, ' ').trim();
const titleCase = (s) =>
  normSpace(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// Strips a trailing office-type suffix (S.O/B.O/H.O, with or without dots,
// with 0-2 spaces between the letters, optionally followed by a truncated
// "-qualifier"), e.g. "Karol Bagh SO" / "Dwarka Sec-6 S.O" / "Lingamgunta
// B.O-An" -> "Karol Bagh" / "Dwarka Sec-6" / "Lingamgunta". A minority of
// raw entries glue the suffix directly onto the name with no separating
// space/hyphen (e.g. "DuppalliB.O") or place it mid-string followed by a
// district qualifier (e.g. "Chainpur SO Gumla") — those aren't caught by
// this pattern and are left as-is; acceptable residual noise on a search-
// assist field, not worth a riskier regex.
const OFFICE_SUFFIX_RE = /[\s-]*\b[SBH]\s{0,2}\.?\s{0,2}O\.?\s{0,2}(-\s*\S+)?\s*$/i;
const cleanLocalityName = (raw) => {
  const stripped = normSpace(normSpace(raw).replace(OFFICE_SUFFIX_RE, ''));
  return stripped || normSpace(raw);
};

function loadRawRecords() {
  if (!fs.existsSync(RAW_FILE)) {
    throw new Error(
      `Raw data file not found at ${RAW_FILE}.\nRun "node scripts/fetchPincodeData.js" first.`
    );
  }
  return JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'));
}

function buildPlaces(records) {
  // key: "PLACE_NAME|STATE_NAME" (both upper-cased) -> { name, state, localities: Map<nameLower, {name, pincode}> }
  const places = new Map();
  let skippedDirty = 0;

  for (const r of records) {
    const stateRaw = normSpace(r.statename).toUpperCase();
    const districtRaw = normSpace(r.district).toUpperCase();
    if (!stateRaw || !districtRaw || stateRaw === 'NA' || districtRaw === 'NA') {
      skippedDirty += 1;
      continue;
    }

    const state = titleCase(r.statename);
    const placeName = METRO_MERGE.get(`${districtRaw}|${stateRaw}`) || titleCase(r.district);
    const key = `${placeName.toUpperCase()}|${state.toUpperCase()}`;

    if (!places.has(key)) {
      places.set(key, { name: placeName, state, localities: new Map() });
    }
    const place = places.get(key);

    const localityName = cleanLocalityName(r.officename);
    const localityKey = localityName.toLowerCase();
    if (!place.localities.has(localityKey)) {
      place.localities.set(localityKey, { name: localityName, pincode: String(r.pincode || '').trim() });
    }
  }

  return { places, skippedDirty };
}

async function seed() {
  console.log('Loading raw pincode records...');
  const records = loadRawRecords();
  console.log(`Loaded ${records.length} raw records.`);

  console.log('Normalizing and deduplicating...');
  const { places, skippedDirty } = buildPlaces(records);
  const totalLocalities = [...places.values()].reduce((sum, p) => sum + p.localities.size, 0);
  console.log(`Skipped ${skippedDirty} dirty records (missing state/district).`);
  console.log(`Built ${places.size} unique places, ${totalLocalities} unique localities.`);

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  console.log('Clearing existing Place/Locality collections...');
  await Locality.deleteMany({});
  await Place.deleteMany({});

  console.log('Inserting places...');
  const placeDocs = [...places.values()].map((p) => ({
    name: p.name,
    nameLower: p.name.toLowerCase(),
    state: p.state,
    localityCount: p.localities.size,
    aliases: (ALIAS_MAP.get(p.name) || []).map((a) => a.toLowerCase()),
  }));
  const insertedPlaces = await Place.insertMany(placeDocs, { ordered: false });

  // Map place key back to its inserted _id for the locality pass below.
  const placeIdByKey = new Map();
  insertedPlaces.forEach((doc) => {
    placeIdByKey.set(`${doc.name.toUpperCase()}|${doc.state.toUpperCase()}`, doc._id);
  });

  console.log('Inserting localities (this is the big one, may take a minute)...');
  const localityDocs = [];
  for (const [key, place] of places) {
    const placeId = placeIdByKey.get(key);
    for (const loc of place.localities.values()) {
      localityDocs.push({
        placeId,
        name: loc.name,
        nameLower: loc.name.toLowerCase(),
        pincode: loc.pincode,
      });
    }
  }

  const BATCH_SIZE = 5000;
  for (let i = 0; i < localityDocs.length; i += BATCH_SIZE) {
    const batch = localityDocs.slice(i, i + BATCH_SIZE);
    await Locality.insertMany(batch, { ordered: false });
    console.log(`  ${Math.min(i + BATCH_SIZE, localityDocs.length)} / ${localityDocs.length} localities inserted`);
  }

  console.log(`\nSeed complete: ${insertedPlaces.length} places, ${localityDocs.length} localities.`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
