// Draft-preview tokens for landing pages: the public endpoint's preview
// path, the admin token endpoint, and protect() refusing preview tokens.
//
// Every DB call is stubbed, so this never connects to Mongo — and it
// deliberately does NOT load .env (which points at production). A
// throwaway JWT secret is set below.
//
//   node scripts/testLandingPreview.js

process.env.JWT_ACCESS_SECRET = 'test-only-secret';

const assert = require('assert');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// The controller destructures these at require time, so stub the module
// exports BEFORE requiring it.
const resolveTaxonomy = require('../src/utils/resolveTaxonomy');
const landingService = require('../src/services/landingPage.service');
const publicController = require('../src/controllers/public.controller');

const CATEGORY = { _id: new mongoose.Types.ObjectId(), slug: 'interior-designers', name: 'Interior Designers' };
resolveTaxonomy.resolveCategory = async () => CATEGORY;
landingService.buildVendorFilter = async () => ({ filter: {}, matchedPlace: null });
publicController.attachCardImages = async (vendors) => vendors;

const LandingPage = require('../src/models/LandingPage.model');
const Vendor = require('../src/models/Vendor.model');
const User = require('../src/models/User.model');
const { getPublicLandingPage, createPreviewToken } = require('../src/controllers/landingPage.controller');
const { protect } = require('../src/middleware/auth');
const { signPreviewToken, verifyPreviewToken } = require('../src/utils/landingPreviewToken');

// Version history has its own suite (testLandingVersions.js); stub it here.
const versionService = require('../src/services/landingPageVersion.service');
versionService.recordVersion = async () => null;
versionService.deleteVersionsFor = async () => {};

// ── In-memory pages ──────────────────────────────────────────────────────
const draft = {
  _id: new mongoose.Types.ObjectId(), level: 'city', category: CATEGORY._id, stateSlug: 'delhi', citySlug: 'gaziabad',
  status: 'draft', seo: { indexing: 'index' }, vendorList: { sort: 'featured', limit: 12 }, heading: 'DRAFT',
};
const published = {
  _id: new mongoose.Types.ObjectId(), level: 'city', category: CATEGORY._id, stateSlug: 'delhi', citySlug: 'noida',
  status: 'published', seo: { indexing: 'index' }, vendorList: { sort: 'featured', limit: 12 }, heading: 'LIVE',
};
const PAGES = [draft, published];

// Thenable stand-in for a Mongoose query: chainable, resolves to `value`.
const query = (value) => {
  const q = { select: () => q, populate: () => q, sort: () => q, limit: () => q, then: (ok, ko) => Promise.resolve(value).then(ok, ko) };
  return q;
};
const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => String(doc[k]) === String(v));
LandingPage.findOne = (filter) => query(PAGES.find((p) => matches(p, filter)) || null);
LandingPage.findById = (id) => query(PAGES.find((p) => String(p._id) === String(id))
  ? { ...PAGES.find((p) => String(p._id) === String(id)), category: { slug: CATEGORY.slug } }
  : null);
Vendor.countDocuments = async () => 5;
Vendor.find = () => query([{ _id: 'v1' }, { _id: 'v2' }]);
// protect() would accept ANY id — so a rejection proves the token check, not a missing user.
User.findById = () => query({ _id: 'u1', role: 'admin' });

// ── Harness ──────────────────────────────────────────────────────────────
function call(handler, req) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      set(name, value) { headers[name.toLowerCase()] = value; return this; },
      json(body) { resolve({ status: this.statusCode, body, headers }); return this; },
    };
    handler({ params: {}, query: {}, headers: {}, ...req }, res, (err) => (err ? reject(err) : resolve({ next: true })));
  });
}
const publicGet = (city, preview) => call(getPublicLandingPage, {
  query: { category: CATEGORY.slug, state: 'delhi', city, ...(preview !== undefined && { preview }) },
});
const NO_PAGE = (r) => JSON.stringify({ ...r.body, data: { ...r.body.data } });

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

(async () => {
  // Baseline: what a URL with no page at all returns.
  const absent = await publicGet('no-such-city');

  await check('valid token + draft → page returned, preview true, indexable false, no-store', async () => {
    const r = await publicGet('gaziabad', signPreviewToken(draft._id).token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.data.page.heading, 'DRAFT');
    assert.strictEqual(r.body.data.preview, true);
    assert.strictEqual(r.body.data.indexable, false); // even though seo.indexing is 'index'
    assert.strictEqual(r.body.data.vendorCount, 5);
    assert.strictEqual(r.body.data.vendors.length, 2);
    assert.strictEqual(r.headers['cache-control'], 'no-store');
  });

  await check('valid token for a published page → preview true, indexable forced false', async () => {
    const r = await publicGet('noida', signPreviewToken(published._id).token);
    assert.strictEqual(r.body.data.page.heading, 'LIVE');
    assert.strictEqual(r.body.data.preview, true);
    assert.strictEqual(r.body.data.indexable, false);
  });

  // Every "no valid preview" case must be indistinguishable from no page.
  const hidden = async (preview) => {
    const r = await publicGet('gaziabad', preview);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.data.page, null);
    assert.strictEqual('preview' in r.body.data, false);
    assert.strictEqual(r.headers['cache-control'], undefined);
    assert.strictEqual(NO_PAGE(r), NO_PAGE(absent), 'response differs from a non-existent page');
  };

  await check('no token + draft → hidden, identical to a non-existent page', () => hidden(undefined));

  await check('valid token for a DIFFERENT page → draft hidden', () => hidden(signPreviewToken(published._id).token));

  await check('expired token → draft hidden', () => hidden(
    jwt.sign({ purpose: 'landing-preview', lp: String(draft._id), exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_ACCESS_SECRET)
  ));

  await check('tampered token (payload swapped, signature kept) → draft hidden', async () => {
    const [h, , s] = signPreviewToken(published._id).token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ purpose: 'landing-preview', lp: String(draft._id), exp: 9999999999 })).toString('base64url');
    await hidden(`${h}.${forgedPayload}.${s}`);
  });

  await check('token signed with another secret → draft hidden', () => hidden(
    jwt.sign({ purpose: 'landing-preview', lp: String(draft._id) }, 'some-other-secret', { expiresIn: '30m' })
  ));

  await check('login-style token { id } → draft hidden', () => hidden(
    jwt.sign({ id: 'u1' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' })
  ));

  await check('wrong purpose → draft hidden', () => hidden(
    jwt.sign({ purpose: 'password-reset', lp: String(draft._id) }, process.env.JWT_ACCESS_SECRET, { expiresIn: '30m' })
  ));

  await check('alg "none" token → draft hidden', () => hidden(
    `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ purpose: 'landing-preview', lp: String(draft._id) })).toString('base64url')}.`
  ));

  await check('garbage / array-valued preview param → draft hidden', async () => {
    await hidden('not-a-jwt');
    await hidden([signPreviewToken(draft._id).token, 'x']);
  });

  await check('published page, no token → unchanged (no preview key, normal indexable)', async () => {
    const r = await publicGet('noida');
    assert.strictEqual(r.body.data.page.heading, 'LIVE');
    assert.deepStrictEqual(Object.keys(r.body.data), ['page', 'vendors', 'vendorCount', 'indexable']);
    assert.strictEqual(r.body.data.indexable, true);
    assert.strictEqual(r.headers['cache-control'], undefined);
  });

  await check('verifyPreviewToken returns the page id for a fresh token', () => {
    assert.strictEqual(verifyPreviewToken(signPreviewToken(draft._id).token), String(draft._id));
  });

  await check('POST preview-token → { token, expiresAt ~30m, path with token }', async () => {
    const r = await call(createPreviewToken, { params: { id: String(draft._id) } });
    assert.strictEqual(r.status, 200);
    const { token, expiresAt, path } = r.body.data;
    assert.strictEqual(verifyPreviewToken(token), String(draft._id));
    const minutes = (new Date(expiresAt) - Date.now()) / 60000;
    assert.ok(minutes > 29 && minutes <= 30, `expiresAt ${minutes} min away`);
    assert.strictEqual(path, `/interior-designers/delhi/gaziabad/?preview=${token}`);
  });

  await check('POST preview-token for a missing / malformed id → 404', async () => {
    assert.strictEqual((await call(createPreviewToken, { params: { id: String(new mongoose.Types.ObjectId()) } })).status, 404);
    assert.strictEqual((await call(createPreviewToken, { params: { id: 'nope' } })).status, 404);
  });

  await check('protect() rejects a preview token (401), even though the user lookup would succeed', async () => {
    const r = await call(protect, { headers: { authorization: `Bearer ${signPreviewToken(draft._id).token}` } });
    assert.strictEqual(r.next, undefined, 'preview token reached next()');
    assert.strictEqual(r.status, 401);
  });

  await check('protect() rejects a token that has id AND a purpose claim', async () => {
    const t = jwt.sign({ id: 'u1', purpose: 'landing-preview', lp: String(draft._id) }, process.env.JWT_ACCESS_SECRET);
    const r = await call(protect, { headers: { authorization: `Bearer ${t}` } });
    assert.strictEqual(r.status, 401);
  });

  await check('protect() still accepts a normal login token', async () => {
    const t = jwt.sign({ id: 'u1' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
    const r = await call(protect, { headers: { authorization: `Bearer ${t}` } });
    assert.strictEqual(r.next, true);
  });

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
