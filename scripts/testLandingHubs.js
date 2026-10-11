// Landing pages Phase 4C: state- and category-level pages — model
// normalisation, the unique key across levels, level immutability,
// indexability, the public endpoint, preview paths, duplicate, bulk create,
// the sitemap payload and match-check, through the real controllers, the
// real model validation and the REAL vendor-scope filters.
//
// Every DB call is stubbed with in-memory collections and a small Mongo
// filter matcher, so this never connects to Mongo — and it deliberately
// does NOT load .env (which points at production).
//
//   node scripts/testLandingHubs.js

process.env.JWT_ACCESS_SECRET = 'test-only-secret';

const assert = require('assert');
const mongoose = require('mongoose');

const publicController = require('../src/controllers/public.controller');
publicController.attachCardImages = async (vendors) => vendors.map((v) => ({ ...v }));

const LandingPage = require('../src/models/LandingPage.model');
const ServiceCategory = require('../src/models/ServiceCategory.model');
const Vendor = require('../src/models/Vendor.model');
const Place = require('../src/models/Place.model');
const versionService = require('../src/services/landingPageVersion.service');
versionService.recordVersion = async () => null;
versionService.deleteVersionsFor = async () => {};

const {
  getLandingPages, createLandingPage, updateLandingPage, createPreviewToken, matchCheck,
  duplicateLandingPage, bulkCreateLandingPages, getPublicLandingPage, getLandingPagesSitemap,
} = require('../src/controllers/landingPage.controller');
const { getCategoryCities, getStates } = require('../src/controllers/place.controller');
const { computeIndexable, buildStateVendorFilter, buildCategoryVendorFilter } = require('../src/services/landingPage.service');
const { copyContent } = require('../src/utils/landingPageCopy');
const { signPreviewToken } = require('../src/utils/landingPreviewToken');

const id = () => new mongoose.Types.ObjectId();
const eq = (a, b) => String(a) === String(b);

// ── Minimal Mongo filter matcher (the operators these handlers use) ──────
function valuesAt(doc, path) {
  let current = [doc];
  for (const key of path.split('.')) {
    const next = [];
    for (const v of current) {
      if (v == null) continue;
      const child = v[key];
      if (Array.isArray(child)) next.push(...child);
      else if (child !== undefined) next.push(child);
    }
    current = next;
  }
  return current;
}
function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some((sub) => matches(doc, sub));
    const values = valuesAt(doc, key);
    if (cond instanceof RegExp) return values.some((v) => typeof v === 'string' && cond.test(v));
    if (cond && typeof cond === 'object' && !(cond instanceof mongoose.Types.ObjectId)) {
      if ('$in' in cond) return values.some((v) => cond.$in.some((c) => eq(c, v)));
      if ('$ne' in cond) return !values.some((v) => eq(v, cond.$ne));
      if ('$elemMatch' in cond) {
        const arr = doc[key] || [];
        return arr.some((el) => matches(el, cond.$elemMatch));
      }
    }
    if (cond === undefined) return true;
    return values.length ? values.some((v) => eq(v, cond)) : (cond === '' || cond === null);
  });
}

// Thenable stand-in for a Mongoose query.
// `clone` (LandingPage rows only) round-trips through JSON like a real read.
function query(rowsFn, { single = false, hydrateFn = null, populateMap = {}, clone = false } = {}) {
  let limit = null;
  const populated = new Set();
  const q = {
    select: () => q,
    sort: () => q,
    skip: () => q,
    limit: (n) => { limit = n; return q; },
    populate: (path) => { populated.add(path); return q; },
    then: (ok, ko) => Promise.resolve().then(() => {
      let rows = rowsFn();
      if (limit != null) rows = rows.slice(0, limit);
      rows = rows.map((r) => {
        if (!clone) return r;
        const copy = JSON.parse(JSON.stringify(r));
        for (const path of populated) if (populateMap[path]) copy[path] = populateMap[path](copy[path]);
        return populated.size === 0 && hydrateFn ? hydrateFn(copy) : copy;
      });
      return single ? (rows[0] || null) : rows;
    }).then(ok, ko),
  };
  return q;
}

// ── Fixtures ─────────────────────────────────────────────────────────────
const CAT = { _id: id(), slug: 'interior-designers', name: 'Interior Designers', isActive: true };
const ARCH = { _id: id(), slug: 'architects', name: 'Architects', isActive: true };
const OLD = { _id: id(), slug: 'wallpaper', name: 'Wallpaper', isActive: false };
const CATEGORIES = [CAT, ARCH, OLD];

const PUNE = { _id: id(), name: 'Pune', state: 'Maharashtra', aliases: [] };
const NASHIK = { _id: id(), name: 'Nashik', state: 'Maharashtra', aliases: [] };
const LUCKNOW = { _id: id(), name: 'Lucknow', state: 'Uttar Pradesh', aliases: [] };
const PLACES = [PUNE, NASHIK, LUCKNOW];

const vendor = (name, fields) => ({
  _id: id(), businessName: name, isApproved: true, isListingEnabled: true, primaryCategory: CAT._id,
  location: {}, serviceLocations: [], isFeatured: false, rating: 0, createdAt: new Date().toISOString(), ...fields,
});
const VENDORS = [
  vendor('v1 Pune', { location: { placeId: PUNE._id, city: 'Pune', state: 'Maharashtra' } }),
  vendor('v2 Pune+Nashik', { location: { placeId: PUNE._id }, serviceLocations: [{ placeId: NASHIK._id, city: 'Nashik', state: 'Maharashtra' }] }),
  vendor('v3 Lucknow home, serves Nashik', { location: { placeId: LUCKNOW._id }, serviceLocations: [{ placeId: NASHIK._id }] }),
  vendor('v4 unlisted', { isApproved: false, location: { placeId: PUNE._id } }),
  vendor('v5 other category', { primaryCategory: ARCH._id, location: { placeId: PUNE._id } }),
  vendor('v6 unresolved, free-text Maharashtra', { location: { city: 'Thane', state: 'maharashtra' } }),
  vendor('v7 unresolved, free-text Goa', { location: { city: 'Panaji', state: 'Goa' } }),
];

const ServiceCategoryStub = {
  findOne: (filter) => query(() => CATEGORIES.filter((c) => matches(c, filter)), { single: true }),
  findById: (catId) => query(() => CATEGORIES.filter((c) => eq(c._id, catId)), { single: true }),
};
ServiceCategory.findOne = ServiceCategoryStub.findOne;
ServiceCategory.findById = ServiceCategoryStub.findById;
ServiceCategory.exists = async (filter) => CATEGORIES.find((c) => matches(c, filter)) ? { _id: filter._id } : null;
ServiceCategory.find = (filter) => query(() => CATEGORIES.filter((c) => matches(c, filter)));

Place.distinct = async (field) => [...new Set(PLACES.map((p) => p[field]))];
Place.find = (filter) => query(() => PLACES.filter((p) => matches(p, filter)));

let vendorFindFilters = [];
Vendor.countDocuments = async (filter) => VENDORS.filter((v) => matches(v, filter)).length;
Vendor.find = (filter) => { vendorFindFilters.push(filter); return query(() => VENDORS.filter((v) => matches(v, filter))); };

// LandingPage "collection" with the real unique (category, stateSlug, citySlug) key.
let store = [];
const hydrate = (obj) => LandingPage.hydrate(obj);
const categoryById = (catId) => {
  const c = CATEGORIES.find((x) => eq(x._id, catId));
  return c ? { ...c } : null;
};
const lpQuery = (rowsFn, single) => query(rowsFn, { single, clone: true, hydrateFn: hydrate, populateMap: { category: categoryById, updatedBy: () => null, createdBy: () => null } });
LandingPage.find = (filter = {}) => lpQuery(() => store.filter((p) => matches(p, filter)), false);
LandingPage.findOne = (filter) => lpQuery(() => store.filter((p) => matches(p, filter)), true);
LandingPage.findById = (pageId) => lpQuery(() => store.filter((p) => eq(p._id, pageId)), true);
LandingPage.countDocuments = async (filter) => store.filter((p) => matches(p, filter)).length;
LandingPage.exists = async (filter) => store.find((p) => matches(p, filter)) || null;
LandingPage.prototype.save = async function save() {
  const obj = JSON.parse(JSON.stringify(this.toObject()));
  const clash = store.find((p) => !eq(p._id, obj._id) && eq(p.category, obj.category)
    && p.stateSlug === obj.stateSlug && p.citySlug === obj.citySlug);
  if (clash) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
  store = store.filter((p) => !eq(p._id, obj._id)).concat(obj);
  return this;
};

const ADMIN = id();
function call(handler, req) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      locals: {},
      status(code) { this.statusCode = code; return this; },
      set(name, value) { headers[name.toLowerCase()] = value; return this; },
      json(body) { resolve({ status: this.statusCode, body, headers, locals: this.locals }); return this; },
    };
    handler({ params: {}, query: {}, body: {}, user: { _id: ADMIN }, ...req }, res, (err) => (err ? reject(err) : resolve({ next: true })));
  });
}
const create = (body) => call(createLandingPage, { body });
const update = (pageId, body) => call(updateLandingPage, { params: { id: String(pageId) }, body });
const publicGet = (q) => call(getPublicLandingPage, { query: q });
const stored = (pageId) => store.find((p) => eq(p._id, pageId));

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${err.message.split('\n').join('\n      ')}`);
  }
}

(async () => {
  // ── Model ──────────────────────────────────────────────────────────────
  await check('model: category level blanks state/city and both slugs', async () => {
    const doc = new LandingPage({ level: 'category', category: CAT._id, state: 'Maharashtra', city: 'Pune' });
    await doc.validate();
    assert.deepStrictEqual([doc.state, doc.city, doc.stateSlug, doc.citySlug], ['', '', '', '']);
  });

  await check('model: state level keeps state, blanks city', async () => {
    const doc = new LandingPage({ level: 'state', category: CAT._id, state: ' Uttar  Pradesh ', city: 'Lucknow' });
    await doc.validate();
    assert.deepStrictEqual([doc.stateSlug, doc.city, doc.citySlug], ['uttar-pradesh', '', '']);
  });

  await check('model: state level requires state; category level requires neither; city as before', async () => {
    await assert.rejects(new LandingPage({ level: 'state', category: CAT._id }).validate(), /state is required/);
    await new LandingPage({ level: 'category', category: CAT._id }).validate();
    await assert.rejects(new LandingPage({ level: 'city', category: CAT._id, state: 'Goa' }).validate(), /city is required/);
    const city = new LandingPage({ category: CAT._id, state: 'Maharashtra', city: 'Pune' });
    await city.validate();
    assert.deepStrictEqual([city.level, city.stateSlug, city.citySlug], ['city', 'maharashtra', 'pune']);
  });

  await check('model: vendorList.enabled defaults true (existing city docs unchanged), limit still 1–50', async () => {
    const doc = new LandingPage({ category: CAT._id, state: 'Goa', city: 'Panaji' });
    assert.strictEqual(doc.vendorList.enabled, true);
    doc.vendorList.limit = 51;
    await assert.rejects(doc.validate(), /vendorList.limit/);
    // A legacy document without the field hydrates with the default.
    assert.strictEqual(LandingPage.hydrate({ _id: id(), category: CAT._id, vendorList: { sort: 'featured', limit: 12 } }).vendorList.enabled, true);
  });

  // ── Create / unique key ────────────────────────────────────────────────
  let categoryPage; let statePage; let cityPage;
  await check('create: category, state and city pages for one category never collide', async () => {
    const a = await create({ level: 'category', category: String(CAT._id), state: 'ignored', city: 'ignored' });
    const b = await create({ level: 'state', category: String(CAT._id), state: 'Maharashtra', city: 'ignored' });
    const c = await create({ category: String(CAT._id), state: 'Maharashtra', city: 'Pune' });
    assert.deepStrictEqual([a.status, b.status, c.status], [201, 201, 201], JSON.stringify([a.body, b.body, c.body]));
    [categoryPage, statePage, cityPage] = [a, b, c].map((r) => r.body.data.page);
    assert.deepStrictEqual([categoryPage.level, categoryPage.stateSlug, categoryPage.citySlug], ['category', '', '']);
    assert.deepStrictEqual([statePage.level, statePage.stateSlug, statePage.citySlug], ['state', 'maharashtra', '']);
    assert.strictEqual(cityPage.level, 'city');
  });

  await check('create: hubs default vendorList.enabled=false, city pages keep true; explicit true respected', async () => {
    assert.strictEqual(categoryPage.vendorList.enabled, false);
    assert.strictEqual(statePage.vendorList.enabled, false);
    assert.strictEqual(cityPage.vendorList.enabled, true);
    const r = await create({ level: 'state', category: String(CAT._id), state: 'Goa', vendorList: { enabled: true, limit: 5 } });
    assert.strictEqual(r.status, 201);
    assert.deepStrictEqual([r.body.data.page.vendorList.enabled, r.body.data.page.vendorList.limit], [true, 5]);
  });

  await check('create: duplicates within a level → 409 (category, state, city)', async () => {
    const a = await create({ level: 'category', category: String(CAT._id) });
    const b = await create({ level: 'state', category: String(CAT._id), state: 'maharashtra' });
    const c = await create({ category: String(CAT._id), state: 'Maharashtra', city: 'PUNE' });
    assert.deepStrictEqual([a.status, b.status, c.status], [409, 409, 409]);
    assert.match(a.body.message, /category page already exists/);
    assert.match(b.body.message, /maharashtra already exists/i);
  });

  await check('create: required fields per level; invalid level → 400', async () => {
    assert.strictEqual((await create({ level: 'state', category: String(CAT._id) })).status, 400);
    assert.strictEqual((await create({ level: 'category' })).status, 400);
    assert.strictEqual((await create({ category: String(CAT._id), state: 'Goa' })).body.message, 'category, state and city are required.');
    assert.strictEqual((await create({ level: 'country', category: String(CAT._id) })).status, 400);
  });

  // ── Update ─────────────────────────────────────────────────────────────
  await check('update: changing level → 400 "Page type can\'t be changed."; nothing saved', async () => {
    for (const [page, level] of [[statePage, 'city'], [categoryPage, 'state'], [cityPage, 'category']]) {
      const before = JSON.stringify(stored(page._id));
      const r = await update(page._id, { level, heading: 'changed' });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.body.message, "Page type can't be changed.");
      assert.strictEqual(JSON.stringify(stored(page._id)), before);
    }
  });

  await check('update: same level is accepted; state edit on a state page works; city stays blank', async () => {
    const r = await update(statePage._id, { level: 'state', state: 'Uttar Pradesh', city: 'Lucknow', heading: 'UP' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.data.page.stateSlug, r.body.data.page.citySlug, r.body.data.page.city], ['uttar-pradesh', '', '']);
    const back = await update(statePage._id, { state: 'Maharashtra' });
    assert.strictEqual(back.body.data.page.stateSlug, 'maharashtra');
  });

  await check('update: vendorList.enabled merges without touching sort/limit', async () => {
    await update(statePage._id, { vendorList: { sort: 'rating', limit: 2 } });
    const r = await update(statePage._id, { vendorList: { enabled: true } });
    assert.deepStrictEqual(
      [r.body.data.page.vendorList.enabled, r.body.data.page.vendorList.sort, r.body.data.page.vendorList.limit], [true, 'rating', 2],
    );
    await update(statePage._id, { vendorList: { enabled: false } });
  });

  // ── computeIndexable ───────────────────────────────────────────────────
  await check('computeIndexable: city unchanged; hubs auto/index → true, noindex → false', () => {
    assert.deepStrictEqual(
      [computeIndexable('city', 'auto', 2), computeIndexable('city', 'auto', 3), computeIndexable('city', 'index', 0), computeIndexable('city', 'noindex', 99)],
      [false, true, true, false],
    );
    for (const level of ['state', 'category']) {
      assert.deepStrictEqual(
        [computeIndexable(level, 'auto', 0), computeIndexable(level, 'index', 0), computeIndexable(level, 'noindex', 99)],
        [true, true, false],
      );
    }
  });

  // ── Vendor scope ───────────────────────────────────────────────────────
  await check('scope: state count equals the vendors spread over category-cities cards (each once)', async () => {
    const { filter, matchedState } = await buildStateVendorFilter(CAT._id, 'maharashtra');
    assert.strictEqual(matchedState, 'Maharashtra');
    const stateCount = await Vendor.countDocuments(filter);
    const cc = await call(getCategoryCities, { query: { category: CAT.slug, state: 'maharashtra' } });
    assert.deepStrictEqual(cc.body.data.cities.map((c) => [c.city, c.vendorCount]), [['Nashik', 2], ['Pune', 2]]);
    // Union of the cards' vendors: v1 (Pune), v2 (Pune + Nashik), v3 (Nashik).
    assert.strictEqual(stateCount, 3);
  });

  await check('scope: unresolved state falls back to free-text state names', async () => {
    const { filter, matchedState } = await buildStateVendorFilter(CAT._id, 'goa');
    assert.strictEqual(matchedState, null);
    assert.strictEqual(await Vendor.countDocuments(filter), 1); // v7
  });

  await check('scope: category filter is exactly GET /public/states?category= vendor query', async () => {
    vendorFindFilters = [];
    await call(getStates, { query: { category: CAT.slug } });
    const { filter } = buildCategoryVendorFilter(CAT._id);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(filter)), JSON.parse(JSON.stringify(vendorFindFilters[0])));
    assert.strictEqual(await Vendor.countDocuments(filter), 5); // v1 v2 v3 v6 v7
  });

  // ── Public endpoint ────────────────────────────────────────────────────
  await check('public: city without state → 400; category missing → 400', async () => {
    assert.strictEqual((await publicGet({ category: CAT.slug, city: 'pune' })).status, 400);
    assert.strictEqual((await publicGet({ state: 'maharashtra' })).status, 400);
  });

  await check('public: no published hub → page null, vendors [], vendorCount, indexable true, level', async () => {
    const r = await publicGet({ category: CAT.slug, state: 'maharashtra' }); // draft only
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.data, { page: null, vendors: [], vendorCount: 3, indexable: true, level: 'state' });
    const c = await publicGet({ category: CAT.slug });
    assert.deepStrictEqual(c.body.data, { page: null, vendors: [], vendorCount: 5, indexable: true, level: 'category' });
  });

  await check('public: published hub with vendors disabled → vendors [] but vendorCount present', async () => {
    await update(statePage._id, { status: 'published' });
    await update(categoryPage._id, { status: 'published' });
    const r = await publicGet({ category: CAT.slug, state: 'maharashtra' });
    assert.strictEqual(r.body.data.page.heading, 'UP');
    assert.deepStrictEqual(Object.keys(r.body.data), ['page', 'vendors', 'vendorCount', 'indexable', 'level']);
    assert.deepStrictEqual([r.body.data.vendors, r.body.data.vendorCount, r.body.data.indexable, r.body.data.level], [[], 3, true, 'state']);
    const c = await publicGet({ category: CAT.slug });
    assert.strictEqual(c.body.data.page.level, 'category');
    assert.deepStrictEqual([c.body.data.vendors, c.body.data.vendorCount], [[], 5]);
  });

  await check('public: vendors enabled → sorted/limited list in scope', async () => {
    await update(statePage._id, { vendorList: { enabled: true, limit: 2 } });
    const r = await publicGet({ category: CAT.slug, state: 'Maharashtra' });
    assert.strictEqual(r.body.data.vendors.length, 2);
    assert.ok(r.body.data.vendors.every((v) => !/unlisted|other|free-text/.test(v.businessName)));
    await update(statePage._id, { vendorList: { enabled: false } });
  });

  await check('public: hub noindex → indexable false (3-vendor rule never applies to hubs)', async () => {
    await update(categoryPage._id, { seo: { indexing: 'noindex' } });
    assert.strictEqual((await publicGet({ category: CAT.slug })).body.data.indexable, false);
    await update(categoryPage._id, { seo: { indexing: 'auto' } });
    // A state with zero vendors in scope is still indexable.
    const goa = store.find((p) => p.level === 'state' && p.stateSlug === 'goa');
    await update(goa._id, { status: 'published' });
    const r = await publicGet({ category: CAT.slug, state: 'goa' });
    assert.deepStrictEqual([r.body.data.indexable], [true]);
  });

  await check('public: city response shape unchanged (no level key) and ignores hub pages', async () => {
    await update(cityPage._id, { status: 'published' });
    const r = await publicGet({ category: CAT.slug, state: 'maharashtra', city: 'pune' });
    assert.deepStrictEqual(Object.keys(r.body.data), ['page', 'vendors', 'vendorCount', 'indexable']);
    assert.strictEqual(r.body.data.page.level, 'city');
    assert.strictEqual(r.body.data.vendorCount, 2);
    assert.strictEqual(r.body.data.indexable, false); // auto, 2 < 3
  });

  await check('public: hub preview — valid token → draft shown, preview, indexable false, no-store', async () => {
    const draft = (await create({ level: 'state', category: String(ARCH._id), state: 'Maharashtra', heading: 'ARCH DRAFT' })).body.data.page;
    const hidden = await publicGet({ category: ARCH.slug, state: 'maharashtra' });
    assert.strictEqual(hidden.body.data.page, null);
    const token = signPreviewToken(draft._id).token;
    const r = await publicGet({ category: ARCH.slug, state: 'maharashtra', preview: token });
    assert.deepStrictEqual([r.body.data.page.heading, r.body.data.preview, r.body.data.indexable], ['ARCH DRAFT', true, false]);
    assert.strictEqual(r.headers['cache-control'], 'no-store');
    // The same token on another level's URL is just "no page".
    const wrong = await publicGet({ category: ARCH.slug, preview: token });
    assert.deepStrictEqual(JSON.stringify(wrong.body), JSON.stringify((await publicGet({ category: ARCH.slug })).body));
    assert.strictEqual(wrong.headers['cache-control'], undefined);
    const garbage = await publicGet({ category: ARCH.slug, state: 'maharashtra', preview: 'nope' });
    assert.deepStrictEqual(JSON.stringify(garbage.body), JSON.stringify(hidden.body));
  });

  // ── Preview path ───────────────────────────────────────────────────────
  await check('preview-token path per level', async () => {
    const path = async (page) => (await call(createPreviewToken, { params: { id: String(page._id) } })).body.data.path.split('?')[0];
    assert.strictEqual(await path(categoryPage), '/interior-designers/');
    assert.strictEqual(await path(statePage), '/interior-designers/maharashtra/');
    assert.strictEqual(await path(cityPage), '/interior-designers/maharashtra/pune/');
  });

  // ── Duplicate ──────────────────────────────────────────────────────────
  await check('duplicate: state page → { state } in the same category, draft, level kept, warnings', async () => {
    await update(statePage._id, {
      heading: 'Designers across Maharashtra', vendorList: { enabled: true },
      sections: [{ type: 'localities', title: 'Regions', localities: ['Konkan', 'Vidarbha'] }],
    });
    const r = await call(duplicateLandingPage, { params: { id: String(statePage._id) }, body: { state: 'Gujarat', city: 'ignored' } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const p = r.body.data.page;
    assert.deepStrictEqual([p.level, p.status, p.stateSlug, p.citySlug, String(p.category)], ['state', 'draft', 'gujarat', '', String(CAT._id)]);
    assert.strictEqual(p.vendorList.enabled, true);
    const fields = r.body.data.warnings.map((w) => w.field);
    assert.ok(fields.includes('heading') && fields.includes('sections.0.localities'), JSON.stringify(r.body.data.warnings));
    assert.match(r.body.data.warnings.find((w) => w.field === 'sections.0.localities').message, /copied from Maharashtra/);
    assert.deepStrictEqual([r.locals.auditDetails.sourceLabel, r.locals.auditDetails.newLabel], ['Interior Designers — Maharashtra', 'Interior Designers — Gujarat']);
  });

  await check('duplicate: state page → existing state 409, missing state 400', async () => {
    assert.strictEqual((await call(duplicateLandingPage, { params: { id: String(statePage._id) }, body: { state: 'gujarat' } })).status, 409);
    assert.strictEqual((await call(duplicateLandingPage, { params: { id: String(statePage._id) }, body: {} })).status, 400);
  });

  await check('duplicate: category page → { category }, warns on the old category name', async () => {
    await update(categoryPage._id, { intro: 'The best Interior Designers in India.' });
    const r = await call(duplicateLandingPage, { params: { id: String(categoryPage._id) }, body: { category: String(ARCH._id) } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const p = r.body.data.page;
    assert.deepStrictEqual([p.level, p.status, String(p.category), p.stateSlug, p.citySlug], ['category', 'draft', String(ARCH._id), '', '']);
    assert.deepStrictEqual(r.body.data.warnings.map((w) => [w.field, w.match]), [['intro', 'Interior Designers']]);
    assert.deepStrictEqual([r.locals.auditDetails.sourceLabel, r.locals.auditDetails.newLabel], ['Interior Designers', 'Architects']);
  });

  await check('duplicate: category page → existing 409, inactive/unknown category 400, missing 400', async () => {
    const dup = (body) => call(duplicateLandingPage, { params: { id: String(categoryPage._id) }, body });
    assert.strictEqual((await dup({ category: String(ARCH._id) })).status, 409);
    assert.strictEqual((await dup({ category: String(CAT._id) })).status, 409); // its own category
    assert.strictEqual((await dup({ category: String(OLD._id) })).status, 400);
    assert.strictEqual((await dup({ category: String(id()) })).status, 400);
    assert.strictEqual((await dup({ category: 'nope' })).status, 400);
    assert.strictEqual((await dup({})).status, 400);
  });

  await check('duplicate: city page unchanged ({ state, city }, level city)', async () => {
    const r = await call(duplicateLandingPage, { params: { id: String(cityPage._id) }, body: { state: 'Maharashtra', city: 'Nashik' } });
    assert.strictEqual(r.status, 201);
    assert.deepStrictEqual([r.body.data.page.level, r.body.data.page.citySlug], ['city', 'nashik']);
    assert.strictEqual((await call(duplicateLandingPage, { params: { id: String(cityPage._id) }, body: { state: 'Maharashtra' } })).status, 400);
  });

  await check('copyContent carries level and vendorList.enabled', () => {
    const c = copyContent({ level: 'state', vendorList: { enabled: true, sort: 'rating', limit: 3 } });
    assert.deepStrictEqual([c.level, c.vendorList], ['state', { enabled: true, sort: 'rating', limit: 3 }]);
  });

  // ── Bulk create ────────────────────────────────────────────────────────
  await check('bulk create: hub templates rejected; city template still works', async () => {
    for (const t of [statePage, categoryPage]) {
      const r = await call(bulkCreateLandingPages, { body: { templateId: String(t._id), items: [{ state: 'Goa', city: 'Panaji' }], dryRun: true } });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.body.message, 'Templates must be city pages.');
    }
    const ok = await call(bulkCreateLandingPages, { body: { templateId: String(cityPage._id), items: [{ state: 'Goa', city: 'Panaji' }] } });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.data.results[0].status, 'created');
    assert.strictEqual(stored(ok.body.data.results[0].pageId).level, 'city');
  });

  await check('bulk create: an existing state page never counts as an existing city', async () => {
    const r = await call(bulkCreateLandingPages, { body: { category: String(CAT._id), items: [{ state: 'Gujarat', city: 'Surat' }], dryRun: true } });
    assert.strictEqual(r.body.data.results[0].status, 'ok');
  });

  // ── List ───────────────────────────────────────────────────────────────
  await check('list: ?level= filters and every row has level; invalid level 400', async () => {
    const r = await call(getLandingPages, { query: { level: 'state' } });
    assert.ok(r.body.data.pages.length >= 2);
    assert.ok(r.body.data.pages.every((p) => p.level === 'state'));
    const all = await call(getLandingPages, { query: {} });
    assert.deepStrictEqual(new Set(all.body.data.pages.map((p) => p.level)), new Set(['category', 'state', 'city']));
    assert.strictEqual((await call(getLandingPages, { query: { level: 'x' } })).status, 400);
  });

  // ── Match-check ────────────────────────────────────────────────────────
  await check('match-check: category level → vendorCount + existing page as same-slug', async () => {
    const r = await call(matchCheck, { query: { level: 'category', category: String(CAT._id), state: 'x', city: 'y' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.data.level, 'category');
    assert.strictEqual(r.body.data.vendorCount, 5);
    assert.deepStrictEqual(r.body.data.similar.map((s) => [String(s._id), s.reason]), [[String(categoryPage._id), 'same-slug']]);
    assert.strictEqual('matchedPlace' in r.body.data, false);
    const excl = await call(matchCheck, { query: { level: 'category', category: String(CAT._id), excludeId: String(categoryPage._id) } });
    assert.deepStrictEqual(excl.body.data.similar, []);
  });

  await check('match-check: state level → vendorCount, matchedState, same-slug and similar-name', async () => {
    const r = await call(matchCheck, { query: { level: 'state', category: String(CAT._id), state: 'Maharashtra', city: 'Pune' } });
    assert.deepStrictEqual([r.body.data.vendorCount, r.body.data.matchedState], [3, 'Maharashtra']);
    assert.deepStrictEqual(r.body.data.similar.map((s) => s.reason), ['same-slug']);
    const typo = await call(matchCheck, { query: { level: 'state', category: String(CAT._id), state: 'Gujrat' } });
    assert.deepStrictEqual([typo.body.data.matchedState, typo.body.data.similar.map((s) => [s.state, s.reason])], [null, [['Gujarat', 'similar-name']]]);
    assert.strictEqual((await call(matchCheck, { query: { level: 'state', category: String(CAT._id) } })).status, 400);
  });

  await check('match-check: city level response unchanged and ignores the state page', async () => {
    const r = await call(matchCheck, { query: { category: String(CAT._id), state: 'Maharashtra', city: 'Pune' } });
    assert.deepStrictEqual(Object.keys(r.body.data), ['matchedPlace', 'vendorsByPlace', 'vendorsByName', 'similar']);
    assert.deepStrictEqual([r.body.data.matchedPlace, r.body.data.vendorsByPlace], ['Pune', 2]);
    assert.ok(r.body.data.similar.every((s) => s.citySlug), JSON.stringify(r.body.data.similar));
    assert.strictEqual((await call(matchCheck, { query: { level: 'bogus', category: String(CAT._id) } })).status, 400);
  });

  // ── Sitemap ────────────────────────────────────────────────────────────
  await check('sitemap: every published level with level + correct indexable; drafts/inactive skipped', async () => {
    await update(statePage._id, { seo: { indexing: 'noindex' } });
    const inactive = new LandingPage({ level: 'category', category: OLD._id, status: 'published' });
    await inactive.validate();
    await inactive.save();
    const r = await call(getLandingPagesSitemap, {});
    const rows = r.body.data.pages.map((p) => [p.level, p.categorySlug, p.stateSlug, p.citySlug, p.indexable]).sort();
    assert.deepStrictEqual(rows, [
      ['category', 'interior-designers', '', '', true], // auto
      ['city', 'interior-designers', 'maharashtra', 'pune', false], // auto, 2 vendors < 3
      ['state', 'interior-designers', 'goa', '', true], // auto, 0 vendors
      ['state', 'interior-designers', 'maharashtra', '', false], // noindex
    ]); // drafts (duplicates, bulk-created Panaji, the Architects draft) and the inactive category are absent
    assert.ok(r.body.data.pages.every((p) => 'updatedAt' in p));
  });

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
