// User input in public regex filters (GET /public/vendors city / locality /
// specialization, GET /public/gallery room / style) is matched literally,
// capped, and non-string query values (arrays, ?x[$ne]=y objects) are
// ignored instead of reaching Mongo.
//
// Pure helper tests plus the real app against a throwaway LOCAL Mongo
// database (refuses non-local URIs, never loads .env). Needs a local
// mongod — see scripts/testProjectVisibility.js.
//
//   node scripts/testRegexInput.js

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');
const { escapeRegex, queryString, containsRegex, MAX_QUERY_LENGTH } = require('../src/utils/regex');

const URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27099/intrafer_regex_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) {
  console.error(`refusing non-local database: ${URI}`);
  process.exit(1);
}

const app = require('../src/app');
const User = require('../src/models/User.model');
const Vendor = require('../src/models/Vendor.model');
const Project = require('../src/models/Project.model');
const ServiceCategory = require('../src/models/ServiceCategory.model');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const NASTY = ['.*', '(a+)+$', '[', '\\', '(', '*', '?', '^$', 'Pune|Mumbai', 'x'.repeat(10000), `${'a'.repeat(40)}!`];

(async () => {
  await test('escapeRegex: every metacharacter matches literally', () => {
    for (const s of NASTY.concat(['a.b', 'a+b', '{1,2}', 'a]b'])) {
      assert.ok(new RegExp(`^${escapeRegex(s)}$`).test(s), s.slice(0, 20));
    }
    assert.ok(!new RegExp(escapeRegex('.*')).test('Pune'));
  });

  await test('queryString: strings trimmed + capped; non-strings and empties → undefined', () => {
    assert.strictEqual(queryString('  Pune '), 'Pune');
    assert.strictEqual(queryString('x'.repeat(500)).length, MAX_QUERY_LENGTH);
    for (const v of [undefined, null, '', '   ', ['Pune'], { $ne: 'x' }, 42, true]) assert.strictEqual(queryString(v), undefined);
  });

  await test('containsRegex: case-insensitive literal contains; catastrophic pattern is inert and fast', () => {
    assert.ok(containsRegex('pune').test('Pune'));
    assert.ok(containsRegex('PUN').test('Pune'));
    assert.ok(!containsRegex('P.ne').test('Pune'));
    const t = Date.now();
    assert.ok(!containsRegex('(a+)+$').test(`${'a'.repeat(5000)}!`));
    assert.ok(Date.now() - t < 50);
  });

  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 3000 });
  } catch (err) {
    console.error(`cannot reach local Mongo at ${URI}: ${err.message}`);
    process.exit(1);
  }
  await mongoose.connection.db.dropDatabase();

  await ServiceCategory.create({ name: 'Interior Designers', slug: 'interior-designers', schemaOrgType: 'HomeAndConstructionBusiness' });
  let n = 0;
  const vendor = async (businessName, city, specializations) => {
    n += 1;
    const u = await User.create({ name: businessName, email: `rx${n}@local.test`, passwordHash: 'x', role: 'vendor' });
    return Vendor.create({ userId: u._id, businessName, isApproved: true, isListingEnabled: true, location: { city, state: 'Maharashtra' }, specializations });
  };
  const pune = await vendor('Pune Studio', 'Pune', ['Modern']);
  const mumbai = await vendor('Mumbai Studio', 'Mumbai', ['Traditional']);
  await Project.create([
    { vendorId: pune._id, title: 'Kitchen 1', projectType: 'Modular Kitchen', style: 'Modern', isPublished: true },
    { vendorId: mumbai._id, title: 'Bed 1', projectType: 'Bedroom', style: 'Traditional', isPublished: true },
  ]);

  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/public`;
  const get = async (path) => {
    const t = Date.now();
    const res = await fetch(`${base}${path}`);
    return { status: res.status, body: await res.json(), ms: Date.now() - t };
  };
  const names = (r) => (r.body.data?.vendors || []).map((v) => v.businessName).sort();
  const titles = (r) => (r.body.data?.projects || []).map((p) => p.title).sort();
  const q = encodeURIComponent;

  try {
    await test('vendors: normal city / locality / specialization results unchanged (case-insensitive contains)', async () => {
      assert.deepStrictEqual(names(await get('/vendors?city=pune')), ['Pune Studio']);
      assert.deepStrictEqual(names(await get('/vendors?city=Mum')), ['Mumbai Studio']);
      assert.deepStrictEqual(names(await get('/vendors?locality=PUNE')), ['Pune Studio']);
      assert.deepStrictEqual(names(await get('/vendors?specialization=traditional')), ['Mumbai Studio']);
      assert.deepStrictEqual(names(await get('/vendors')), ['Mumbai Studio', 'Pune Studio']);
    });

    for (const field of ['city', 'locality', 'specialization']) {
      await test(`vendors ?${field}=: regex metacharacters, alternation and long input are literal, 200, fast`, async () => {
        for (const s of NASTY) {
          const r = await get(`/vendors?${field}=${q(s)}`);
          assert.strictEqual(r.status, 200, s.slice(0, 20));
          assert.deepStrictEqual(names(r), [], `${field}=${s.slice(0, 20)} matched something`);
          assert.ok(r.ms < 1000, `${field}=${s.slice(0, 20)} took ${r.ms}ms`);
        }
      });
      await test(`vendors ?${field}: array / object values are ignored (no filter), not operators`, async () => {
        const all = ['Mumbai Studio', 'Pune Studio'];
        assert.deepStrictEqual(names(await get(`/vendors?${field}[$ne]=x`)), all);
        assert.deepStrictEqual(names(await get(`/vendors?${field}[$regex]=.*`)), all);
        assert.deepStrictEqual(names(await get(`/vendors?${field}[]=Pune&${field}[]=Mumbai`)), all);
      });
    }

    await test('vendors category/state/city branch: operator objects never resolve a category', async () => {
      const r = await get('/vendors?category[$ne]=nope&state=maharashtra&city=pune');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.data.meetsThreshold, undefined); // fell through to the plain listing
    });

    await test('gallery ?room / ?style: normal input unchanged; nasty input literal; objects ignored', async () => {
      assert.deepStrictEqual(titles(await get('/gallery?room=kitchen')), ['Kitchen 1']);
      assert.deepStrictEqual(titles(await get('/gallery?style=TRAD')), ['Bed 1']);
      for (const field of ['room', 'style']) {
        for (const s of NASTY) {
          const r = await get(`/gallery?${field}=${q(s)}`);
          assert.strictEqual(r.status, 200, `${field}=${s.slice(0, 20)}`);
          assert.deepStrictEqual(titles(r), []);
          assert.ok(r.ms < 1000);
        }
      }
      assert.deepStrictEqual(titles(await get('/gallery?room[$ne]=x&style[]=a')), ['Bed 1', 'Kitchen 1']);
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
