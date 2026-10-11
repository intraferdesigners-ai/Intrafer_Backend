// Public project endpoints never serve a project whose vendor is suspended
// (isApproved: false) or unlisted (isListingEnabled: false): by id it 404s
// exactly like a missing project, and it is absent from every list.
//
// Runs the real app against a throwaway LOCAL Mongo database (dropped first
// and afterwards) — it refuses any non-local URI and never loads .env
// (which points at production). Needs a local mongod, e.g.:
//
//   mongod --dbpath /tmp/mdb --port 27099 --fork --logpath /tmp/mdb.log
//   node scripts/testProjectVisibility.js
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27017/x node scripts/testProjectVisibility.js

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');

const URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27099/intrafer_visibility_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) {
  console.error(`refusing non-local database: ${URI}`);
  process.exit(1);
}

process.env.JWT_ACCESS_SECRET = 'test-only-jwt-secret';

const app = require('../src/app');
const jwt = require('jsonwebtoken');
const User = require('../src/models/User.model');
const Vendor = require('../src/models/Vendor.model');
const Project = require('../src/models/Project.model');

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
    console.error(`cannot reach local Mongo at ${URI} (start a local mongod; see header): ${err.message}`);
    process.exit(1);
  }
  await mongoose.connection.db.dropDatabase();

  let n = 0;
  const vendor = async (name, fields) => {
    n += 1;
    const u = await User.create({ name, email: `vis${n}@local.test`, passwordHash: 'x', role: 'vendor' });
    return Vendor.create({ userId: u._id, businessName: name, isApproved: true, isListingEnabled: true, ...fields });
  };
  const approved = await vendor('Approved Studio', {});
  const suspended = await vendor('Suspended Studio', { isApproved: false, approvalStatus: 'rejected' });
  const unlisted = await vendor('Unlisted Studio', { isListingEnabled: false });

  const base = { projectType: 'Kitchen', isPublished: true, moderationStatus: 'approved', images: ['https://res.cloudinary.com/demo/image/upload/sample.jpg'], completedYear: 2025 };
  const [okP, okP2, susP, unlP] = await Project.create([
    { ...base, vendorId: approved._id, title: 'Approved project', isFeatured: true },
    { ...base, vendorId: approved._id, title: 'Approved project 2' },
    { ...base, vendorId: suspended._id, title: 'Suspended vendor project', isFeatured: true },
    { ...base, vendorId: unlisted._id, title: 'Unlisted vendor project', isFeatured: true },
  ]);
  const hidden = { suspended: susP, unlisted: unlP };

  const server = http.createServer(app).listen(0);
  const base_ = `http://127.0.0.1:${server.address().port}/api/public`;
  const get = async (path) => {
    const res = await fetch(`${base_}${path}`);
    return { status: res.status, body: await res.json() };
  };
  const ids = (list) => (list || []).map((p) => String(p._id)).sort();

  try {
    await test('approved vendor: project by id is served (vendor populated)', async () => {
      const r = await get(`/projects/${okP._id}`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.data.project.vendorId.businessName, 'Approved Studio');
    });

    for (const [kind, p] of Object.entries(hidden)) {
      await test(`${kind} vendor: project by id is a 404 identical to a missing project`, async () => {
        const r = await get(`/projects/${p._id}`);
        const missing = await get(`/projects/${new mongoose.Types.ObjectId()}`);
        assert.strictEqual(r.status, 404);
        assert.deepStrictEqual(r.body, missing.body);
      });
      await test(`${kind} vendor: related-projects for it 404s too`, async () => {
        assert.strictEqual((await get(`/projects/${p._id}/related`)).status, 404);
      });
      await test(`${kind} vendor: its projects list is empty, like a nonexistent vendor's`, async () => {
        const r = await get(`/vendors/${p.vendorId}/projects`);
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.body.data.projects, []);
      });
    }

    await test('approved vendor: its projects list is served', async () => {
      assert.deepStrictEqual(ids((await get(`/vendors/${approved._id}/projects`)).body.data.projects), ids([okP, okP2]));
    });

    await test('related projects of a visible project never include hidden vendors\' projects', async () => {
      const r = await get(`/projects/${okP._id}/related`);
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(ids(r.body.data.projects), ids([okP2]));
    });

    await test('gallery (unpaginated, as /gallery and /recent-projects call it) has only visible projects', async () => {
      assert.deepStrictEqual(ids((await get('/gallery')).body.data.projects), ids([okP, okP2]));
    });

    await test('gallery (paginated, as the sitemap calls it): list, total and totalPages exclude hidden', async () => {
      const r = await get('/gallery?page=1&limit=50');
      assert.deepStrictEqual(ids(r.body.data.projects), ids([okP, okP2]));
      assert.strictEqual(r.body.data.total, 2);
      assert.strictEqual(r.body.data.totalPages, 1);
    });

    await test('featured projects (home) exclude hidden vendors\' featured and filler projects', async () => {
      assert.deepStrictEqual(ids((await get('/featured-projects')).body.data.projects), ids([okP, okP2]));
    });

    await test('stats projectCount (home/about) counts only visible projects', async () => {
      assert.strictEqual((await get('/stats')).body.data.projectCount, 2);
    });

    await test('admin projects list carries each vendor\'s visibility fields (read-only)', async () => {
      const admin = await User.create({ name: 'Admin', email: 'vis-admin@local.test', passwordHash: 'x', role: 'admin', isSuperAdmin: true });
      const res = await fetch(`${base_}`.replace('/public', '/admin/projects?limit=50'), {
        headers: { authorization: `Bearer ${jwt.sign({ id: String(admin._id) }, process.env.JWT_ACCESS_SECRET)}` },
      });
      assert.strictEqual(res.status, 200);
      const byTitle = Object.fromEntries((await res.json()).data.projects.map((p) => [p.title, p.vendorId]));
      assert.deepStrictEqual(byTitle['Approved project'], { _id: String(approved._id), businessName: 'Approved Studio', isApproved: true, isListingEnabled: true, approvalStatus: 'approved' });
      assert.deepStrictEqual(byTitle['Suspended vendor project'], { _id: String(suspended._id), businessName: 'Suspended Studio', isApproved: false, isListingEnabled: true, approvalStatus: 'rejected' });
      assert.deepStrictEqual(byTitle['Unlisted vendor project'], { _id: String(unlisted._id), businessName: 'Unlisted Studio', isApproved: true, isListingEnabled: false, approvalStatus: 'approved' });
    });

    await test('re-approving / re-listing a vendor brings its projects back', async () => {
      await Vendor.updateOne({ _id: suspended._id }, { isApproved: true, approvalStatus: 'approved' });
      await Vendor.updateOne({ _id: unlisted._id }, { isListingEnabled: true });
      assert.strictEqual((await get(`/projects/${susP._id}`)).status, 200);
      assert.strictEqual((await get(`/projects/${unlP._id}`)).status, 200);
      assert.strictEqual((await get('/gallery')).body.data.projects.length, 4);
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
