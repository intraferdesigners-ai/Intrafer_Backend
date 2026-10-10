// Landing pages Phase 4A: duplicate, bulk create, bulk publish/unpublish/
// delete — through the real controllers and the real model validation.
//
// Every DB call is stubbed with an in-memory store, so this never connects
// to Mongo — and it deliberately does NOT load .env (which points at
// production).
//
//   node scripts/testLandingBulk.js

const assert = require('assert');
const mongoose = require('mongoose');

// The controller destructures these at require time — stub first.
const landingService = require('../src/services/landingPage.service');
const BANGALORE_PLACE = { _id: new mongoose.Types.ObjectId() };
landingService.resolvePlaceWithAliases = async (stateSlug, citySlug) => (
  stateSlug === 'karnataka' && ['bengaluru', 'bangalore'].includes(citySlug) ? BANGALORE_PLACE : null
);
landingService.buildVendorFilter = async (categoryId, stateSlug, citySlug) => ({ filter: { citySlug }, matchedPlace: null });

const LandingPage = require('../src/models/LandingPage.model');
const ServiceCategory = require('../src/models/ServiceCategory.model');
const Vendor = require('../src/models/Vendor.model');
const {
  duplicateLandingPage, bulkCreateLandingPages, bulkLandingPageAction, updateLandingPage,
} = require('../src/controllers/landingPage.controller');
const { findSourceMentions, copyContent } = require('../src/utils/landingPageCopy');

const CAT = new mongoose.Types.ObjectId();
const OTHER_CAT = new mongoose.Types.ObjectId();
const ADMIN = new mongoose.Types.ObjectId();
const ORIGINAL_ADMIN = new mongoose.Types.ObjectId();

// ── In-memory "collection" ───────────────────────────────────────────────
let store = [];
const writes = { save: 0, delete: 0 };
const query = (value) => {
  const q = { select: () => q, populate: () => q, sort: () => q, then: (ok, ko) => Promise.resolve(value).then(ok, ko) };
  return q;
};
const hydrate = (obj) => LandingPage.hydrate(JSON.parse(JSON.stringify(obj)));
const eq = (a, b) => String(a) === String(b);

LandingPage.findById = (id) => query(store.find((p) => eq(p._id, id)) ? hydrate(store.find((p) => eq(p._id, id))) : null);
LandingPage.find = (filter) => {
  let rows = store;
  if (filter._id?.$in) rows = rows.filter((p) => filter._id.$in.some((id) => eq(id, p._id)));
  if (filter.category) rows = rows.filter((p) => eq(p.category, filter.category));
  if (filter.stateSlug?.$in) rows = rows.filter((p) => filter.stateSlug.$in.includes(p.stateSlug));
  return query(rows.map(hydrate));
};
LandingPage.exists = async (filter) => store.find((p) => !eq(p._id, filter._id?.$ne) && eq(p.category, filter.category)
  && p.stateSlug === filter.stateSlug && p.citySlug === filter.citySlug) || null;
LandingPage.deleteOne = async ({ _id }) => { writes.delete += 1; store = store.filter((p) => !eq(p._id, _id)); };
let raceOnNextSave = false;
let lastSave = null; // { modified, validated } of the most recent save()
LandingPage.prototype.save = async function save(options = {}) {
  writes.save += 1;
  const validated = options.validateBeforeSave !== false;
  lastSave = { modified: this.modifiedPaths().filter((p) => !p.includes('.')).sort(), validated };
  if (validated) await this.validate();
  const obj = this.toObject();
  const clash = store.find((p) => !eq(p._id, obj._id) && eq(p.category, obj.category) && p.stateSlug === obj.stateSlug && p.citySlug === obj.citySlug);
  if (clash || raceOnNextSave) {
    raceOnNextSave = false;
    throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
  }
  store = store.filter((p) => !eq(p._id, obj._id)).concat(JSON.parse(JSON.stringify(obj)));
  return this;
};
// Any write that would bypass validation must never be used.
for (const name of ['create', 'insertMany', 'updateOne', 'updateMany', 'findByIdAndUpdate', 'findOneAndUpdate', 'bulkWrite', 'replaceOne']) {
  LandingPage[name] = () => { throw new Error(`LandingPage.${name} must not be called`); };
}
ServiceCategory.exists = async (filter) => ([CAT, OTHER_CAT].some((c) => eq(c, filter._id)) ? { _id: filter._id } : null);
const VENDORS = { pune: 7, nashik: 2 };
Vendor.countDocuments = async (filter) => VENDORS[filter.citySlug] || 0;

// A real model document (so slugs/defaults are what the model derives).
function seed(fields) {
  const doc = new LandingPage({ category: CAT, createdBy: ORIGINAL_ADMIN, updatedBy: ORIGINAL_ADMIN, ...fields });
  return doc.validate().then(() => {
    const obj = JSON.parse(JSON.stringify(doc.toObject()));
    store.push(obj);
    return obj;
  });
}

function call(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      locals: {},
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body, locals: this.locals }); return this; },
    };
    handler({ params: {}, body: {}, user: { _id: ADMIN }, ...req }, res, reject);
  });
}

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
  const pune = await seed({
    state: 'Maharashtra', city: 'Pune', status: 'published', publishedAt: new Date('2026-01-01'),
    banner: { imageUrl: 'https://img.example/pune.jpg', headline: 'Designers in Pune', subheadline: 'Across Maharashtra', ctaLabel: 'Get quotes', ctaUrl: '/contact/' },
    heading: '{{category}} in {{city}}',
    intro: 'Homes in pune deserve better. Punekar families love us.',
    sections: [
      { type: 'text', title: 'Why Pune?', body: 'Because {{city}}.' },
      { type: 'faq', title: 'FAQ', faqItems: [{ question: 'Do you work in PUNE?', answer: 'Yes.' }] },
      { type: 'localities', title: 'Areas', localities: ['Baner', 'Kothrud'] },
    ],
    vendorList: { sort: 'rating', limit: 20 },
    seo: { metaTitle: 'Top designers', metaDescription: 'Best in Maharashtra', ogImage: 'https://img.example/og.jpg', indexing: 'index' },
  });

  // ── Duplicate ──────────────────────────────────────────────────────────
  await check('duplicate: copies content, as a DRAFT with fresh ids, new slugs and the acting admin', async () => {
    const r = await call(duplicateLandingPage, { params: { id: String(pune._id) }, body: { state: '  Maharashtra ', city: 'Nashik  ' } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const p = r.body.data.page;
    assert.strictEqual(p.status, 'draft');
    assert.strictEqual(p.publishedAt, null);
    assert.strictEqual(p.city, 'Nashik');
    assert.strictEqual(p.citySlug, 'nashik');
    assert.strictEqual(p.stateSlug, 'maharashtra');
    assert.notStrictEqual(String(p._id), String(pune._id));
    assert.strictEqual(String(p.createdBy), String(ADMIN));
    assert.strictEqual(String(p.updatedBy), String(ADMIN));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(p.banner)), pune.banner);
    assert.strictEqual(p.heading, pune.heading);
    assert.strictEqual(p.intro, pune.intro);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(p.vendorList)), pune.vendorList);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(p.seo)), pune.seo);
    assert.strictEqual(p.sections.length, 3);
    p.sections.forEach((sec, i) => {
      assert.ok(sec._id, 'section has an _id');
      assert.notStrictEqual(String(sec._id), String(pune.sections[i]._id), 'section _id is fresh');
      assert.strictEqual(sec.title, pune.sections[i].title);
    });
    assert.deepStrictEqual([...p.sections[2].localities], ['Baner', 'Kothrud']);
    assert.strictEqual(store.find((x) => eq(x._id, pune._id)).status, 'published', 'source untouched');
  });

  await check('duplicate: warnings name the copied city (word boundary, any case) and the localities', async () => {
    const r = await call(duplicateLandingPage, { params: { id: String(pune._id) }, body: { state: 'Gujarat', city: 'Surat' } });
    const w = r.body.data.warnings;
    const fields = w.map((x) => `${x.field}:${x.match || ''}`);
    assert.deepStrictEqual(fields, [
      'banner.headline:Pune', 'banner.subheadline:Maharashtra', 'intro:Pune', 'sections.0.title:Pune',
      'sections.1.faqItems.0.question:Pune', 'seo.metaDescription:Maharashtra', 'sections.2.localities:',
    ]);
    assert.ok(w.find((x) => x.field === 'sections.2.localities').message.startsWith('Localities were copied from Pune'));
  });

  await check('duplicate: same state is not flagged; {{city}} placeholders never are', async () => {
    const w = findSourceMentions(pune, { state: 'Maharashtra', city: 'Mumbai' });
    assert.ok(!w.some((x) => x.match === 'Maharashtra'));
    assert.ok(!w.some((x) => x.field === 'heading'), 'heading is {{category}} in {{city}}');
  });

  await check('mention rule: "Punekar" and "Pune2" are not "Pune"; "Pune\'s", "(Pune)" and multi-word names are', () => {
    const hit = (text, city = 'Pune') => findSourceMentions({ city, intro: text }, { city: 'X' }).length > 0;
    assert.strictEqual(hit('Punekar homes'), false);
    assert.strictEqual(hit('Pune2 office'), false);
    assert.strictEqual(hit("Pune's best"), true);
    assert.strictEqual(hit('(Pune)'), true);
    assert.strictEqual(hit('in navi   MUMBAI today', 'Navi Mumbai'), true);
    assert.strictEqual(hit('Mumbai only', 'Navi Mumbai'), false);
  });

  await check('duplicate: 404 missing source, 400 blank state/city, 409 existing target', async () => {
    assert.strictEqual((await call(duplicateLandingPage, { params: { id: String(new mongoose.Types.ObjectId()) }, body: { state: 'A', city: 'B' } })).status, 404);
    assert.strictEqual((await call(duplicateLandingPage, { params: { id: 'nope' }, body: { state: 'A', city: 'B' } })).status, 404);
    assert.strictEqual((await call(duplicateLandingPage, { params: { id: String(pune._id) }, body: { state: ' ', city: 'B' } })).status, 400);
    const r = await call(duplicateLandingPage, { params: { id: String(pune._id) }, body: { state: 'maharashtra', city: 'NASHIK' } });
    assert.strictEqual(r.status, 409);
    assert.match(r.body.message, /already exists/);
  });

  await check('copyContent never carries _id, slugs, status, publishedAt, createdBy/updatedBy or timestamps', () => {
    const c = copyContent(pune);
    for (const k of ['_id', 'stateSlug', 'citySlug', 'status', 'publishedAt', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'state', 'city', 'category']) {
      assert.ok(!(k in c), `${k} copied`);
    }
    assert.ok(c.sections.every((s) => !('_id' in s)));
  });

  // ── Bulk create ────────────────────────────────────────────────────────
  await seed({ state: 'Karnataka', city: 'Bengaluru', status: 'draft' });
  const bulk = (body) => call(bulkCreateLandingPages, { body });
  const ITEMS = [
    { state: 'Maharashtra', city: 'Pune' },           // exists
    { state: ' Gujarat ', city: 'Ahmedabad' },         // ok
    { state: 'gujarat', city: '  ahmedabad ' },        // duplicate_in_batch
    { state: '', city: 'Nowhere' },                    // invalid
    { state: 'Karnataka', city: 'Bangalore' },         // similar (alias of Bengaluru)
    { state: 'Maharashtra', city: 'Pimpri  Chinchwad' }, // ok
    { state: 'Goa', city: 'x'.repeat(81) },            // invalid (too long)
    { state: 'Gujarat', city: '<b></b>' },             // invalid (no letters after HTML strip)
  ];

  await check('bulk: 0 / 51 items → 400; neither template nor category → 400; unknown template → 404', async () => {
    assert.strictEqual((await bulk({ category: String(CAT), items: [] })).status, 400);
    assert.strictEqual((await bulk({ category: String(CAT), items: Array.from({ length: 51 }, (_, i) => ({ state: 'A', city: `C${i}` })) })).status, 400);
    assert.strictEqual((await bulk({ items: [{ state: 'A', city: 'B' }] })).status, 400);
    assert.strictEqual((await bulk({ templateId: String(new mongoose.Types.ObjectId()), items: [{ state: 'A', city: 'B' }] })).status, 404);
  });

  await check('bulk dryRun: statuses, vendor counts, summary — and zero writes, not audited', async () => {
    const before = { ...writes, size: store.length };
    const r = await bulk({ templateId: String(pune._id), items: ITEMS, dryRun: true });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const res = r.body.data.results;
    assert.deepStrictEqual(res.map((x) => x.status), ['exists', 'ok', 'duplicate_in_batch', 'invalid', 'similar', 'ok', 'invalid', 'invalid']);
    assert.strictEqual(String(res[0].existingId), String(pune._id));
    assert.strictEqual(res[1].state, 'Gujarat');
    assert.strictEqual(res[1].citySlug, 'ahmedabad');
    assert.strictEqual(res[2].duplicateOf, 1);
    assert.strictEqual(res[3].reason, 'State is required.');
    assert.strictEqual(res[4].similarTo.city, 'Bengaluru');
    assert.strictEqual(res[5].city, 'Pimpri Chinchwad');
    assert.match(res[6].reason, /80 characters/);
    assert.match(res[7].reason, /letters or digits/);
    assert.strictEqual(res[0].vendorCount, 7);
    assert.strictEqual(res[1].vendorCount, 0);
    assert.strictEqual('vendorCount' in res[3], false);
    assert.deepStrictEqual(r.body.data.summary, { total: 8, exists: 1, ok: 2, duplicate_in_batch: 1, invalid: 3, similar: 1 });
    assert.deepStrictEqual({ ...writes, size: store.length }, before, 'dry run wrote something');
    assert.strictEqual(r.locals.skipAudit, true);
  });

  await check('bulk real run: creates only ok + similar, all drafts with template content; one audit entry with counts', async () => {
    const before = store.length;
    const r = await bulk({ templateId: String(pune._id), items: ITEMS });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const res = r.body.data.results;
    assert.deepStrictEqual(res.map((x) => x.status), ['exists', 'created', 'duplicate_in_batch', 'invalid', 'created', 'created', 'invalid', 'invalid']);
    assert.deepStrictEqual(r.body.data.summary, { created: 3, failed: 0, skipped: 5 });
    assert.strictEqual(store.length, before + 3);
    for (const x of res.filter((y) => y.status === 'created')) {
      const doc = store.find((p) => eq(p._id, x.pageId));
      assert.strictEqual(doc.status, 'draft');
      assert.strictEqual(doc.publishedAt, null);
      assert.strictEqual(doc.intro, pune.intro);
      assert.strictEqual(doc.seo.indexing, 'index');
      assert.ok(x.warnings.some((w) => w.match === 'Pune'));
    }
    assert.ok(!res[5].warnings.some((w) => w.match === 'Maharashtra'), 'same state not flagged');
    assert.deepStrictEqual(r.locals.auditDetails, { created: 3, failed: 0, skipped: 5, templateId: String(pune._id), category: String(CAT) });
    assert.strictEqual(r.locals.skipAudit, undefined);
  });

  await check('bulk: blank drafts by category; a race (E11000) becomes "exists" and the run continues', async () => {
    raceOnNextSave = true;
    const r = await bulk({ category: String(CAT), items: [{ state: 'Kerala', city: 'Kochi' }, { state: 'Kerala', city: 'Kozhikode' }] });
    assert.deepStrictEqual(r.body.data.results.map((x) => x.status), ['exists', 'created']);
    const doc = store.find((p) => p.citySlug === 'kozhikode');
    assert.strictEqual(doc.status, 'draft');
    assert.strictEqual(doc.intro, '');
    assert.deepStrictEqual(r.body.data.results[1].warnings, []);
  });

  await check('bulk: template from another category is allowed, with a warning, created in the chosen category', async () => {
    const r = await bulk({ templateId: String(pune._id), category: String(OTHER_CAT), items: [{ state: 'Maharashtra', city: 'Pune' }] });
    assert.deepStrictEqual(r.body.data.warnings, ['The template is from a different category.']);
    assert.strictEqual(r.body.data.results[0].status, 'created'); // Pune doesn't exist in OTHER_CAT
    assert.ok(eq(store.find((p) => eq(p._id, r.body.data.results[0].pageId)).category, OTHER_CAT));
  });

  await check('bulk: a template that fails current validation reports "failed" per item (plain English), nothing saved', async () => {
    const legacy = await seed({ state: 'Goa', city: 'Panaji', banner: { ctaLabel: 'Call us' }, status: 'draft' }).catch(() => null);
    assert.strictEqual(legacy, null, 'CTA-pair rule rejects it at seed time too');
    store.push({ ...JSON.parse(JSON.stringify(store.find((p) => p.citySlug === 'kozhikode'))), _id: String(new mongoose.Types.ObjectId()), citySlug: 'old', city: 'Old', banner: { ctaLabel: 'Call us', ctaUrl: '', imageUrl: '', headline: '', subheadline: '' } });
    const tpl = store[store.length - 1];
    const before = store.length;
    const r = await bulk({ templateId: String(tpl._id), items: [{ state: 'Goa', city: 'Margao' }] });
    assert.strictEqual(r.body.data.results[0].status, 'failed');
    assert.strictEqual(r.body.data.results[0].reason, LandingPage.CTA_PAIR_MESSAGE);
    assert.deepStrictEqual(r.body.data.summary, { created: 0, failed: 1, skipped: 0 });
    assert.strictEqual(store.length, before);
  });

  // ── Bulk action ────────────────────────────────────────────────────────
  const action = (ids, act) => call(bulkLandingPageAction, { body: { ids, action: act } });
  const ahmedabad = store.find((p) => p.citySlug === 'ahmedabad');
  const bengaluru = store.find((p) => p.citySlug === 'bengaluru');
  const legacyTpl = store.find((p) => p.citySlug === 'old');

  await check('bulk-action publish: ok / unchanged / failed (left as draft) / not_found, keeps going', async () => {
    const missing = String(new mongoose.Types.ObjectId());
    const r = await action([String(ahmedabad._id), String(pune._id), String(legacyTpl._id), missing, 'not-an-id', String(bengaluru._id)], 'publish');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.data.results.map((x) => x.status), ['ok', 'unchanged', 'failed', 'not_found', 'not_found', 'ok']);
    assert.strictEqual(r.body.data.results[2].message, LandingPage.CTA_PAIR_MESSAGE);
    assert.strictEqual(store.find((p) => p.citySlug === 'old').status, 'draft');
    const pub = store.find((p) => p.citySlug === 'ahmedabad');
    assert.strictEqual(pub.status, 'published');
    assert.ok(pub.publishedAt, 'publishedAt set on first publish');
    assert.strictEqual(String(pub.updatedBy), String(ADMIN));
    assert.deepStrictEqual(r.body.data.summary, { ok: 2, unchanged: 1, failed: 1, not_found: 2 });
    assert.strictEqual(r.locals.auditDetails.action, 'publish');
    assert.strictEqual(r.locals.auditDetails.ids.length, 6);
  });

  await check('bulk-action is idempotent: publishing again → unchanged; unpublish → ok then unchanged', async () => {
    assert.deepStrictEqual((await action([String(ahmedabad._id)], 'publish')).body.data.results.map((x) => x.status), ['unchanged']);
    assert.deepStrictEqual((await action([String(ahmedabad._id)], 'unpublish')).body.data.results.map((x) => x.status), ['ok']);
    assert.strictEqual(store.find((p) => p.citySlug === 'ahmedabad').status, 'draft');
    assert.deepStrictEqual((await action([String(ahmedabad._id)], 'unpublish')).body.data.results.map((x) => x.status), ['unchanged']);
  });

  await check('bulk-action delete: ok, then not_found; duplicate ids handled once', async () => {
    const id = String(bengaluru._id);
    const r = await action([id, id], 'delete');
    assert.deepStrictEqual(r.body.data.results, [{ id, status: 'ok' }]);
    assert.strictEqual(store.some((p) => eq(p._id, id)), false);
    assert.deepStrictEqual((await action([id], 'delete')).body.data.results.map((x) => x.status), ['not_found']);
  });

  await check('bulk-action validation: >100 ids, 0 ids, bad action → 400; audited ids capped at 100', async () => {
    const many = Array.from({ length: 101 }, () => String(new mongoose.Types.ObjectId()));
    assert.strictEqual((await action(many, 'publish')).status, 400);
    assert.strictEqual((await action([], 'publish')).status, 400);
    assert.strictEqual((await action([String(pune._id)], 'archive')).status, 400);
    const r = await action(many.slice(0, 100), 'unpublish');
    assert.strictEqual(r.locals.auditDetails.ids.length, 100);
    assert.strictEqual(r.body.data.summary.not_found, 100);
  });

  // ── Unpublish is never blocked by validation ───────────────────────────
  // Live, but invalid by today's rules: CTA label without URL, an http://
  // image and raw HTML (inserted raw, as an old page would be).
  const brokenId = String(new mongoose.Types.ObjectId());
  const broken = {
    ...JSON.parse(JSON.stringify(pune)), _id: brokenId, city: 'Broken', citySlug: 'broken', status: 'published',
    heading: '<b>Raw</b> heading', banner: { ...pune.banner, imageUrl: 'http://old.example/x.jpg', ctaLabel: 'Call us', ctaUrl: '' },
  };
  store.push(broken);
  const snapshot = (id) => {
    const { status, updatedBy, updatedAt, ...rest } = JSON.parse(JSON.stringify(store.find((p) => eq(p._id, id))));
    return rest;
  };

  await check('bulk unpublish of a page invalid by today\'s rules → ok, draft, nothing else touched, no validation', async () => {
    const before = snapshot(brokenId);
    const r = await action([brokenId], 'unpublish');
    assert.deepStrictEqual(r.body.data.results, [{ id: brokenId, status: 'ok' }]);
    const after = store.find((p) => eq(p._id, brokenId));
    assert.strictEqual(after.status, 'draft');
    assert.strictEqual(String(after.updatedBy), String(ADMIN));
    assert.deepStrictEqual(snapshot(brokenId), before, 'a field other than status/updatedBy changed');
    assert.strictEqual(after.heading, '<b>Raw</b> heading', 'not re-sanitised');
    assert.deepStrictEqual(lastSave, { modified: ['status', 'updatedBy'], validated: false });
  });

  await check('same page: bulk publish still fails with the plain-English messages and stays draft', async () => {
    const r = await action([brokenId], 'publish');
    assert.strictEqual(r.body.data.results[0].status, 'failed');
    // Both of today's rules it breaks — publish re-checks the old image too.
    assert.strictEqual(r.body.data.results[0].message, `${LandingPage.CTA_PAIR_MESSAGE}, banner.imageUrl must be an https:// URL.`);
    assert.strictEqual(store.find((p) => eq(p._id, brokenId)).status, 'draft');
  });

  await check('single-page unpublish (PUT { status: "draft" }) succeeds on the invalid page, touching only status/updatedBy', async () => {
    store.find((p) => eq(p._id, brokenId)).status = 'published';
    const before = snapshot(brokenId);
    const otherAdmin = new mongoose.Types.ObjectId();
    const r = await call(updateLandingPage, { params: { id: brokenId }, body: { status: 'draft' }, user: { _id: otherAdmin } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(String(store.find((p) => eq(p._id, brokenId)).updatedBy), String(otherAdmin));
    assert.strictEqual(store.find((p) => eq(p._id, brokenId)).status, 'draft');
    assert.deepStrictEqual(snapshot(brokenId), before);
    assert.deepStrictEqual(lastSave, { modified: ['status', 'updatedBy'], validated: false });
  });

  await check('single-page PUT with status draft PLUS other fields still validates (normal save path)', async () => {
    const r = await call(updateLandingPage, { params: { id: brokenId }, body: { status: 'draft', heading: 'New' } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.errors['banner.ctaUrl'], LandingPage.CTA_PAIR_MESSAGE);
  });

  await check('single-page publish (PUT { status: "published" }) still validates', async () => {
    const r = await call(updateLandingPage, { params: { id: brokenId }, body: { status: 'published' } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(store.find((p) => eq(p._id, brokenId)).status, 'draft');
  });

  // ── Audit middleware ───────────────────────────────────────────────────
  await check('auditLog middleware stores res.locals.auditDetails and honours skipAudit', async () => {
    const AuditLog = require('../src/models/AuditLog.model');
    const auditLog = require('../src/middleware/auditLog');
    const logged = [];
    AuditLog.create = async (doc) => { logged.push(doc); };
    const run = (locals) => {
      const handlers = {};
      const res = { statusCode: 200, locals, on: (ev, fn) => { handlers[ev] = fn; } };
      const req = { user: { _id: ADMIN, name: 'A', email: 'a@x.invalid' }, method: 'POST', originalUrl: '/x', params: {}, ip: '' };
      auditLog('Bulk')(req, res, () => {});
      handlers.finish();
    };
    run({ auditDetails: { created: 3 } });
    run({ skipAudit: true });
    run({});
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(logged.length, 2);
    assert.deepStrictEqual(logged[0].details, { created: 3 });
    assert.strictEqual('details' in logged[1], false);
  });

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
