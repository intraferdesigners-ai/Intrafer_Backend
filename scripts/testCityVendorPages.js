// City vendor-list pagination: GET /public/landing-page?…&vendorPage=N
// (12 per page, the page's own sort) and GET /public/vendors?…&page=N
// (stable order for ties), against a throwaway LOCAL Mongo database
// (dropped first and afterwards; refuses any non-local URI, never loads
// .env). Needs a local mongod, e.g.:
//
//   mongod --dbpath /tmp/mdb --port 27099 --fork --logpath /tmp/mdb.log
//   node scripts/testCityVendorPages.js

const assert = require('assert');
const mongoose = require('mongoose');

const URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27099/intrafer_city_pages_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) {
  console.error(`refusing non-local database: ${URI}`);
  process.exit(1);
}

const LandingPage = require('../src/models/LandingPage.model');
const ServiceCategory = require('../src/models/ServiceCategory.model');
const Place = require('../src/models/Place.model');
const User = require('../src/models/User.model');
const Vendor = require('../src/models/Vendor.model');
const { getPublicLandingPage } = require('../src/controllers/landingPage.controller');
const { getVendors } = require('../src/controllers/public.controller');

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`); }
const call = (handler, query) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, set() { return this; }, json(body) { resolve({ status: this.statusCode, body }); return this; } };
  handler({ query, params: {} }, res, (err) => (err ? reject(err) : resolve({ next: true })));
});

(async () => {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 3000 });
  } catch (err) {
    console.error(`cannot reach local Mongo at ${URI}: ${err.message}`);
    process.exit(1);
  }
  await mongoose.connection.db.dropDatabase();
  const cat = await ServiceCategory.create({ name: 'Interior Designers', slug: 'interior-designers', schemaOrgType: 'HomeAndConstructionBusiness' });
  const place = await Place.create({ name: 'Mumbai', nameLower: 'mumbai', state: 'Maharashtra' });
  for (let i = 0; i < 25; i += 1) {
    const u = await User.create({ name: `V${i}`, email: `cp${i}@local.test`, passwordHash: 'x', role: 'vendor' });
    // Same rating for all (as today) and one featured: ties must still page cleanly.
    await Vendor.create({ userId: u._id, businessName: `Studio ${String(i).padStart(2, '0')}`, isListingEnabled: true, isFeatured: i === 7, primaryCategory: cat._id, location: { city: 'Mumbai', state: 'Maharashtra', placeId: place._id } });
  }
  const q = { category: 'interior-designers', state: 'maharashtra', city: 'mumbai' };

  await test('landing endpoint: 12 + 12 + 1 vendors over pages 1-3, no repeats, featured first, page counts', async () => {
    await LandingPage.create({ level: 'city', category: cat._id, city: 'Mumbai', state: 'Maharashtra', status: 'published', intro: 'x', vendorList: { sort: 'featured', limit: 5 } });
    const pages = [];
    for (const vendorPage of ['1', '2', '3']) {
      const { status, body } = await call(getPublicLandingPage, { ...q, vendorPage });
      assert.strictEqual(status, 200);
      assert.strictEqual(body.data.vendorCount, 25);
      assert.strictEqual(body.data.vendorPages, 3);
      assert.strictEqual(body.data.vendorPage, Number(vendorPage));
      pages.push(body.data.vendors.map((v) => String(v._id)));
    }
    assert.deepStrictEqual(pages.map((p) => p.length), [12, 12, 1], 'the admin limit (5) no longer caps a city page');
    assert.strictEqual(new Set(pages.flat()).size, 25);
    const first = (await call(getPublicLandingPage, q)).body.data;
    assert.strictEqual(first.vendors[0].businessName, 'Studio 07', 'featured first');
    assert.deepStrictEqual(first.vendors.map((v) => String(v._id)), pages[0], 'no vendorPage = page 1');
    const past = (await call(getPublicLandingPage, { ...q, vendorPage: '4' })).body.data;
    assert.deepStrictEqual(past.vendors, []);
  });

  await test('landing endpoint: malformed vendorPage is a 400', async () => {
    for (const bad of ['0', '-1', '2.5', 'abc', '01', '10000']) {
      assert.strictEqual((await call(getPublicLandingPage, { ...q, vendorPage: bad })).status, 400, bad);
    }
  });

  await test('/public/vendors: page=1..3&limit=12 cover all 25 once (stable order for tied ratings)', async () => {
    const seen = [];
    for (const page of ['1', '2', '3']) {
      const { body } = await call(getVendors, { ...q, page, limit: '12' });
      assert.strictEqual(body.data.total, 25);
      assert.strictEqual(body.data.totalPages, 3);
      seen.push(...body.data.vendors.map((v) => String(v._id)));
    }
    assert.strictEqual(seen.length, 25);
    assert.strictEqual(new Set(seen).size, 25);
  });

  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  console.log(`\n${passed} passed`);
})().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
