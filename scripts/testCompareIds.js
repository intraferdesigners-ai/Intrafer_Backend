// GET /public/vendors/compare?ids=: malformed input is a 400 (never a 500);
// valid ids — known, unknown or hidden — behave as before.
//
// Runs the real app against a throwaway LOCAL Mongo database (refuses
// non-local URIs, never loads .env). Needs a local mongod — see
// scripts/testProjectVisibility.js.
//
//   node scripts/testCompareIds.js

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');

const URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27099/intrafer_compare_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) {
  console.error(`refusing non-local database: ${URI}`);
  process.exit(1);
}

const app = require('../src/app');
const User = require('../src/models/User.model');
const Vendor = require('../src/models/Vendor.model');

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

  let n = 0;
  const vendor = async (businessName, fields = {}) => {
    n += 1;
    const u = await User.create({ name: businessName, email: `cmp${n}@local.test`, passwordHash: 'x', role: 'vendor' });
    return Vendor.create({ userId: u._id, businessName, isApproved: true, isListingEnabled: true, ...fields });
  };
  const [a, b, c] = [await vendor('A'), await vendor('B'), await vendor('C')];
  const hidden = await vendor('Hidden', { isApproved: false });
  const id = (v) => String(v._id);
  const unknown = String(new mongoose.Types.ObjectId());

  const server = http.createServer(app).listen(0);
  const get = async (qs) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/public/vendors/compare${qs}`);
    return { status: res.status, body: await res.json() };
  };
  const names = (r) => r.body.data.vendors.map((v) => v.businessName).sort();

  try {
    await test('valid ids -> 200 with those vendors (unknown and hidden ids just not listed)', async () => {
      const r = await get(`?ids=${id(a)},${id(b)},${unknown},${id(hidden)}`);
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(names(r), ['A', 'B']);
    });

    await test('no ids, empty ids, only commas -> 200 []', async () => {
      for (const qs of ['', '?ids=', '?ids=,,,']) {
        const r = await get(qs);
        assert.strictEqual(r.status, 200, qs);
        assert.deepStrictEqual(r.body.data.vendors, [], qs);
      }
    });

    await test('4 ids is the limit (duplicates and spaces tolerated)', async () => {
      const r = await get(`?ids=${id(a)},%20${id(b)},${id(c)},${unknown},${id(a)}`);
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(names(r), ['A', 'B', 'C']);
    });

    await test('malformed input -> 400 with a short message, never 500', async () => {
      const five = [a, b, c, hidden].map(id).concat(unknown).join(',');
      for (const qs of [
        `?ids[]=${id(a)}&ids[]=${id(b)}`, `?ids[$ne]=x`, `?ids[a]=1`, `?ids=${id(a)}&ids=${id(b)}`,
        '?ids=abc', `?ids=${id(a)},not-an-id`, '?ids=aaaaaaaaaaaa', `?ids=${id(a)}x`, '?ids=zzzzzzzzzzzzzzzzzzzzzzzz',
        `?ids=${five}`, `?ids=${'x'.repeat(5000)}`,
      ]) {
        const r = await get(qs);
        assert.strictEqual(r.status, 400, `${qs.slice(0, 60)} -> ${r.status}`);
        assert.strictEqual(r.body.success, false);
        assert.ok(typeof r.body.message === 'string' && r.body.message.length < 80, qs.slice(0, 60));
      }
    });

    await test('specific messages: too many ids vs invalid id vs wrong type', async () => {
      assert.match((await get(`?ids=${[a, b, c, hidden].map(id).concat(unknown).join(',')}`)).body.message, /at most 4/);
      assert.match((await get('?ids=abc')).body.message, /Invalid vendor id/);
      assert.match((await get(`?ids[]=${id(a)}`)).body.message, /comma-separated/);
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
