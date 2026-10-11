// Every mutation that changes public visibility or content purges the
// frontend cache with the expected tags — and only after it succeeded.
//
// Runs the real app (real routes, auth, controllers) against a throwaway
// LOCAL Mongo database; only utils/revalidate's low-level purge() is
// stubbed to record what would be sent. JWT and webhook secrets are
// throwaway test values; .env (production) is never loaded. Needs a local
// mongod — see scripts/testProjectVisibility.js.
//
//   node scripts/testPurgeWiring.js

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27099/intrafer_purge_wiring_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) {
  console.error(`refusing non-local database: ${URI}`);
  process.exit(1);
}
process.env.JWT_ACCESS_SECRET = 'test-only-jwt-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-only-webhook-secret';

const cache = require('../src/utils/revalidate');
const sent = [];
cache.purge = async (payload) => { sent.push(payload); return true; };

const app = require('../src/app');
const User = require('../src/models/User.model');
const Vendor = require('../src/models/Vendor.model');
const Project = require('../src/models/Project.model');
const Lead = require('../src/models/Lead.model');
const Subscription = require('../src/models/Subscription.model');
const ServiceCategory = require('../src/models/ServiceCategory.model');
const LandingPage = require('../src/models/LandingPage.model');
const { generateReviewToken } = require('../src/controllers/review.controller');
const { expireSubscriptions } = require('../src/jobs/subscriptionExpiry.job');
const { vendorTags, projectTags, reviewTags, vendorTag } = require('../src/utils/cacheTags');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// The purge calls are fire-and-forget (some do a DB read first): wait for
// `n` of them, then a short grace period to catch any unexpected extra.
async function purges(n) {
  const deadline = Date.now() + 2000;
  while (sent.length < n && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 60));
  return sent.splice(0);
}
const sortTags = (payloads) => payloads.map((p) => ({ tags: [...p.tags].map(String).sort(), paths: p.paths || [] }));
const expectTags = (payloads, ...expected) => assert.deepStrictEqual(
  sortTags(payloads),
  expected.map((e) => ({ tags: [...e.tags].map(String).sort(), paths: e.paths || [] })),
);

(async () => {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 3000 });
  } catch (err) {
    console.error(`cannot reach local Mongo at ${URI}: ${err.message}`);
    process.exit(1);
  }
  await mongoose.connection.db.dropDatabase();

  const category = await ServiceCategory.create({ name: 'Interior Designers', slug: 'interior-designers', schemaOrgType: 'HomeAndConstructionBusiness' });
  const admin = await User.create({ name: 'Admin', email: 'admin@wiring.test', passwordHash: 'x', role: 'admin', isSuperAdmin: true });
  const vUser = await User.create({ name: 'Vendor User', email: 'v@wiring.test', passwordHash: 'x', role: 'vendor' });
  const vendor = await Vendor.create({ userId: vUser._id, businessName: 'Studio', isApproved: true, isListingEnabled: true, location: { city: 'Pune', state: 'Maharashtra' } });
  const [p1, p2] = await Project.create([
    { vendorId: vendor._id, title: 'P1', projectType: 'Kitchen', isPublished: true },
    { vendorId: vendor._id, title: 'P2', projectType: 'Bedroom', isPublished: true },
  ]);
  const vId = String(vendor._id);
  const allVendorTags = () => vendorTags(vId, [p1._id, p2._id]);

  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const token = (u) => jwt.sign({ id: String(u._id) }, process.env.JWT_ACCESS_SECRET);
  const call = async (method, path, body, user = admin) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(user && { authorization: `Bearer ${token(user)}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    assert.ok(res.status < 300, `${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    return json.data;
  };

  try {
    // ── Vendor visibility ───────────────────────────────────────────────
    await test('admin take-down (reject) purges vendor + lists + landing + EVERY project page', async () => {
      await call('PUT', `/admin/vendors/${vId}/approve`, { approve: false, rejectionReason: 'Suspended' });
      const got = await purges(1);
      expectTags(got, { tags: allVendorTags() });
      assert.ok(got[0].tags.map(String).includes(`project:${p1._id}`) && got[0].tags.map(String).includes(`project:${p2._id}`));
    });
    await test('admin reinstate (approve) purges the same set', async () => {
      await call('PUT', `/admin/vendors/${vId}/approve`, { approve: true });
      expectTags(await purges(1), { tags: allVendorTags() });
    });
    await test('admin feature toggle purges the vendor set', async () => {
      await call('PUT', `/admin/vendors/${vId}/feature`);
      expectTags(await purges(1), { tags: allVendorTags() });
    });
    await test('a rejected mutation (400) purges nothing', async () => {
      const res = await fetch(`${base}/admin/vendors/${vId}/approve`, {
        method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token(admin)}` }, body: JSON.stringify({ approve: false }),
      });
      assert.strictEqual(res.status, 400);
      assert.deepStrictEqual(await purges(0), []);
    });
    await test('subscription activation (Razorpay webhook) enables the listing and purges the vendor set', async () => {
      await Vendor.updateOne({ _id: vId }, { isListingEnabled: false });
      await Subscription.create({ vendorId: vId, planName: '1 Month', planPrice: 599900, leadsPerMonth: 10, razorpayOrderId: 'order_test_1', status: 'pending' });
      const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_test_1', order_id: 'order_test_1' } } } });
      const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
      const res = await fetch(`${base}/subscriptions/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, body });
      assert.strictEqual(res.status, 200);
      expectTags(await purges(1), { tags: allVendorTags() });
      assert.strictEqual((await Vendor.findById(vId)).isListingEnabled, true);
    });
    await test('subscription-expiry cron disables the listing and purges the vendor set', async () => {
      await Subscription.updateOne({ razorpayOrderId: 'order_test_1' }, { endDate: new Date(Date.now() - 1000) });
      assert.strictEqual(await expireSubscriptions(), 1);
      expectTags(await purges(1), { tags: allVendorTags() });
      assert.strictEqual((await Vendor.findById(vId)).isListingEnabled, false);
      await Vendor.updateOne({ _id: vId }, { isListingEnabled: true });
    });

    // ── Vendor content ──────────────────────────────────────────────────
    await test('vendor profile edit purges the vendor set', async () => {
      await call('PUT', '/vendor/profile', { businessName: 'Studio Renamed' }, vUser);
      expectTags(await purges(1), { tags: allVendorTags() });
    });
    await test('vendor user name/phone edit purges the vendor set (shown on the profile)', async () => {
      await call('PUT', '/auth/profile', { name: 'New Name' }, vUser);
      expectTags(await purges(1), { tags: allVendorTags() });
    });
    await test('a non-vendor user\'s profile edit purges nothing', async () => {
      await call('PUT', '/auth/profile', { name: 'Admin 2' }, admin);
      assert.deepStrictEqual(await purges(0), []);
    });
    await test('vendor availability edit purges only that vendor page', async () => {
      await call('PUT', '/vendor/availability', { startTime: '10:00' }, vUser);
      expectTags(await purges(1), { tags: [vendorTag(vId)] });
    });

    // ── Projects ────────────────────────────────────────────────────────
    let p3;
    await test('vendor project create purges projects + project:<id> + vendor:<id> + stats', async () => {
      p3 = (await call('POST', '/vendor/projects', { title: 'P3', projectType: 'Kitchen' }, vUser)).project;
      expectTags(await purges(1), { tags: projectTags(p3._id, vId) });
    });
    await test('vendor project edit (incl. publish/unpublish) purges the project set', async () => {
      await call('PUT', `/vendor/projects/${p3._id}`, { title: 'P3 edited', isPublished: false }, vUser);
      expectTags(await purges(1), { tags: projectTags(p3._id, vId) });
    });
    await test('vendor project reorder purges only that vendor page', async () => {
      await call('PUT', '/vendor/projects/reorder', { projectIds: [String(p2._id), String(p1._id)] }, vUser);
      expectTags(await purges(1), { tags: [vendorTag(vId)] });
    });
    await test('vendor project delete purges the project set', async () => {
      await call('DELETE', `/vendor/projects/${p3._id}`, undefined, vUser);
      expectTags(await purges(1), { tags: projectTags(p3._id, vId) });
    });
    await test('admin project moderation (reject / approve) purges the project set', async () => {
      await call('PUT', `/admin/projects/${p1._id}/moderate`, { approve: false, rejectionReason: 'No' });
      expectTags(await purges(1), { tags: projectTags(p1._id, vId) });
      await call('PUT', `/admin/projects/${p1._id}/moderate`, { approve: true });
      expectTags(await purges(1), { tags: projectTags(p1._id, vId) });
    });
    await test('admin project feature toggle purges the project set', async () => {
      await call('PUT', `/admin/projects/${p1._id}/feature`);
      expectTags(await purges(1), { tags: projectTags(p1._id, vId) });
    });

    // ── Reviews ─────────────────────────────────────────────────────────
    await test('review submitted via invite purges reviews + vendor:<id> + vendors + stats', async () => {
      const lead = new Lead({ enquiryId: 'ENQ-WIRING-1', vendorId: vId, city: 'Pune', contactName: 'H', contactEmail: 'h@wiring.test' });
      const raw = generateReviewToken(lead);
      await lead.save();
      await call('POST', `/reviews/invite/${raw}`, { rating: 5, comment: 'Great' }, null);
      expectTags(await purges(1), { tags: reviewTags(vId) });
    });

    // ── CMS / taxonomy ──────────────────────────────────────────────────
    await test('site settings (homepage content) purge homepage', async () => {
      await call('PUT', '/admin/settings', { homepage_hero_subtitle: 'Hello' });
      expectTags(await purges(1), { tags: ['homepage'] });
    });
    await test('city and category create / update / delete each purge taxonomy', async () => {
      const city = (await call('POST', '/admin/cities', { name: 'Wiring City' })).city;
      await call('PUT', `/admin/cities/${city._id}`, { isActive: false });
      await call('DELETE', `/admin/cities/${city._id}`);
      const cat = (await call('POST', '/admin/categories', { name: 'Wiring Cat' })).category;
      await call('PUT', `/admin/categories/${cat._id}`, { isActive: false });
      await call('DELETE', `/admin/categories/${cat._id}`);
      expectTags(await purges(6), ...Array(6).fill({ tags: ['taxonomy'] }));
    });

    // ── Landing pages ───────────────────────────────────────────────────
    const cityPath = '/interior-designers/maharashtra/pune/';
    let page;
    await test('landing create purges landing + the page path', async () => {
      page = (await call('POST', '/admin/landing-pages', { category: String(category._id), state: 'Maharashtra', city: 'Pune' })).page;
      expectTags(await purges(1), { tags: ['landing'], paths: [cityPath] });
    });
    await test('landing update / publish / unpublish purge landing + the page path', async () => {
      await call('PUT', `/admin/landing-pages/${page._id}`, { heading: 'New heading' });
      await call('PUT', `/admin/landing-pages/${page._id}`, { status: 'published' });
      await call('PUT', `/admin/landing-pages/${page._id}`, { status: 'draft' });
      expectTags(await purges(3), { tags: ['landing'], paths: [cityPath] }, { tags: ['landing'], paths: [cityPath] }, { tags: ['landing'], paths: [cityPath] });
    });
    let dup;
    await test('landing duplicate purges landing + the new page path', async () => {
      dup = (await call('POST', `/admin/landing-pages/${page._id}/duplicate`, { state: 'Maharashtra', city: 'Nashik' })).page;
      expectTags(await purges(1), { tags: ['landing'], paths: ['/interior-designers/maharashtra/nashik/'] });
    });
    await test('landing bulk action (publish) purges landing + every touched path', async () => {
      await call('POST', '/admin/landing-pages/bulk-action', { action: 'publish', ids: [String(page._id), String(dup._id)] });
      const got = await purges(1);
      assert.deepStrictEqual(got[0].tags, ['landing']);
      assert.deepStrictEqual([...got[0].paths].sort(), ['/interior-designers/maharashtra/nashik/', cityPath]);
    });
    await test('landing bulk create purges landing', async () => {
      await call('POST', '/admin/landing-pages/bulk', { category: String(category._id), items: [{ state: 'Maharashtra', city: 'Thane' }] });
      expectTags(await purges(1), { tags: ['landing'] });
    });
    await test('landing delete purges landing + the page path', async () => {
      await call('DELETE', `/admin/landing-pages/${dup._id}`);
      expectTags(await purges(1), { tags: ['landing'], paths: ['/interior-designers/maharashtra/nashik/'] });
      assert.ok(await LandingPage.exists({ _id: page._id }));
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
