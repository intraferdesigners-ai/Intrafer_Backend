// GET /public/stats never invents a rating: avgRating is null (and
// reviewCount 0) until real Review documents exist, then it is their exact
// average — unaffected by unrated vendors or by a Vendor.rating field that
// has no reviews behind it.
//
// Runs the real app against a throwaway LOCAL Mongo database (refuses
// non-local URIs, never loads .env). Needs a local mongod — see
// scripts/testProjectVisibility.js.
//
//   node scripts/testStatsNoFabrication.js

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');

const URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27099/intrafer_stats_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) {
  console.error(`refusing non-local database: ${URI}`);
  process.exit(1);
}
process.env.JWT_ACCESS_SECRET = 'test-only-jwt-secret';

const app = require('../src/app');
const User = require('../src/models/User.model');
const Vendor = require('../src/models/Vendor.model');
const Lead = require('../src/models/Lead.model');
const Review = require('../src/models/Review.model');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

(async () => {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 3000 });
  } catch (err) {
    console.error(`cannot reach local Mongo at ${URI}: ${err.message}`);
    process.exit(1);
  }
  await mongoose.connection.db.dropDatabase();

  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const stats = async () => {
    const res = await fetch(`${base}/public/stats`);
    assert.strictEqual(res.status, 200);
    return (await res.json()).data;
  };

  try {
    await test('empty database: no rating, zero counts', async () => {
      const s = await stats();
      assert.strictEqual(s.avgRating, null);
      assert.strictEqual(s.reviewCount, 0);
      assert.strictEqual(s.vendorCount, 0);
    });

    const [u, u2] = await User.create([
      { name: 'V', email: 'stats@local.test', passwordHash: 'x', role: 'vendor' },
      { name: 'W', email: 'stats2@local.test', passwordHash: 'x', role: 'vendor' },
    ]);
    // A seed-style vendor carrying a rating with no Review documents behind
    // it, plus an unrated one — neither may produce a site rating.
    const vendor = await Vendor.create({ userId: u._id, businessName: 'Seeded', isListingEnabled: true, rating: 4.9, reviewCount: 87, location: { city: 'Pune' } });
    await Vendor.create({ userId: u2._id, businessName: 'Unrated', isListingEnabled: true, location: { city: 'Pune' } });

    await test('vendors but no stored reviews: still no rating', async () => {
      const s = await stats();
      assert.strictEqual(s.avgRating, null);
      assert.strictEqual(s.reviewCount, 0);
      assert.strictEqual(s.vendorCount, 2);
    });

    const leads = await Promise.all([1, 2, 3].map((i) => Lead.create({ enquiryId: `ENQ-STATS-${i}`, vendorId: vendor._id, city: 'Pune', status: 'won' })));
    await Review.create([
      { leadId: leads[0]._id, vendorId: vendor._id, rating: 5 },
      { leadId: leads[1]._id, vendorId: vendor._id, rating: 4 },
      { leadId: leads[2]._id, vendorId: vendor._id, rating: 3 },
    ]);

    await test('stored reviews: exact average and count of the reviews themselves', async () => {
      const s = await stats();
      assert.strictEqual(s.avgRating, '4.0');
      assert.strictEqual(s.reviewCount, 3);
      assert.strictEqual(s.enquiryCount, 3);
    });
  } finally {
    server.close();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
  console.log(`\n${passed} passed`);
})().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
