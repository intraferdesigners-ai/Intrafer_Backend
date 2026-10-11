// Malformed ids in public path params and the admin projects ?vendorId=
// filter: never a 500 (cast error). Public endpoints answer exactly what an
// unknown valid id gets; the admin filter answers 400. Valid and unknown
// ids behave as before.
//
// Runs the real app against a throwaway LOCAL Mongo database (refuses
// non-local URIs, never loads .env; test-only JWT secret). Needs a local
// mongod — see scripts/testProjectVisibility.js.
//
//   node scripts/testMalformedIds.js

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27099/intrafer_malformed_ids_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) {
  console.error(`refusing non-local database: ${URI}`);
  process.exit(1);
}
process.env.JWT_ACCESS_SECRET = 'test-only-jwt-secret';

const app = require('../src/app');
const User = require('../src/models/User.model');
const Vendor = require('../src/models/Vendor.model');
const Project = require('../src/models/Project.model');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const MALFORMED = ['abc', 'zzzzzzzzzzzzzzzzzzzzzzzz', '6acbcdeed4ee203dbf3e244', '6acbcdeed4ee203dbf3e24499', "1'%20OR%201=1", 'x'.repeat(300)];

(async () => {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 3000 });
  } catch (err) {
    console.error(`cannot reach local Mongo at ${URI}: ${err.message}`);
    process.exit(1);
  }
  await mongoose.connection.db.dropDatabase();

  const u = await User.create({ name: 'V', email: 'mid@local.test', passwordHash: 'x', role: 'vendor' });
  const vendor = await Vendor.create({ userId: u._id, businessName: 'Studio', isApproved: true, isListingEnabled: true, location: { city: 'Pune' }, specializations: ['Modern'] });
  const project = await Project.create({ vendorId: vendor._id, title: 'P', projectType: 'Kitchen', isPublished: true });
  const admin = await User.create({ name: 'A', email: 'mid-admin@local.test', passwordHash: 'x', role: 'admin', isSuperAdmin: true });
  const unknown = String(new mongoose.Types.ObjectId());

  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const get = async (path, auth) => {
    const res = await fetch(`${base}${path}`, auth ? { headers: { authorization: `Bearer ${jwt.sign({ id: String(admin._id) }, process.env.JWT_ACCESS_SECRET)}` } } : {});
    return { status: res.status, body: await res.json() };
  };

  const ENDPOINTS = [
    ['/public/vendors/:id', String(vendor._id)],
    ['/public/vendors/:id/projects', String(vendor._id)],
    ['/public/vendors/:id/similar', String(vendor._id)],
    ['/public/projects/:id', String(project._id)],
    ['/public/projects/:id/related', String(project._id)],
    ['/reviews/vendor/:id', String(vendor._id)],
  ];

  try {
    for (const [route, known] of ENDPOINTS) {
      await test(`${route}: known id -> 200; malformed ids -> exactly the unknown-id response, never 500`, async () => {
        const ok = await get(route.replace(':id', known));
        assert.strictEqual(ok.status, 200, `known -> ${ok.status}`);
        const missing = await get(route.replace(':id', unknown));
        assert.notStrictEqual(missing.status, 500);
        for (const bad of MALFORMED) {
          const r = await get(route.replace(':id', bad));
          assert.strictEqual(r.status, missing.status, `${bad.slice(0, 30)} -> ${r.status}`);
          assert.deepStrictEqual(r.body, missing.body, bad.slice(0, 30));
        }
      });
    }

    await test('the unknown-id responses themselves are unchanged (404 / empty list)', async () => {
      assert.strictEqual((await get(`/public/vendors/${unknown}`)).status, 404);
      assert.deepStrictEqual((await get(`/public/vendors/${unknown}/projects`)).body.data, { projects: [] });
      assert.strictEqual((await get(`/public/vendors/${unknown}/similar`)).status, 404);
      assert.strictEqual((await get(`/public/projects/${unknown}`)).status, 404);
      assert.strictEqual((await get(`/public/projects/${unknown}/related`)).status, 404);
      assert.strictEqual((await get(`/reviews/vendor/${unknown}`)).status, 404);
    });

    await test('admin projects ?vendorId=: valid / unknown / absent -> 200; malformed or repeated -> 400', async () => {
      assert.strictEqual((await get(`/admin/projects?vendorId=${vendor._id}`, true)).body.data.total, 1);
      assert.strictEqual((await get(`/admin/projects?vendorId=${unknown}`, true)).body.data.total, 0);
      assert.strictEqual((await get('/admin/projects', true)).status, 200);
      assert.strictEqual((await get('/admin/projects?vendorId=', true)).status, 200);
      for (const qs of ['vendorId=abc', 'vendorId=zzzzzzzzzzzzzzzzzzzzzzzz', `vendorId=${vendor._id}&vendorId=${unknown}`]) {
        const r = await get(`/admin/projects?${qs}`, true);
        assert.strictEqual(r.status, 400, qs);
        assert.strictEqual(r.body.message, 'vendorId must be a vendor id.');
      }
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
