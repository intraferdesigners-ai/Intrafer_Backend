// Duplicate-text warning for landing pages (warn only): the fingerprint
// (utils/landingFingerprint.js), the report (services/landingDuplicates
// .service.js) and what the admin endpoints return.
//
// Pure tests first, then the real controllers against a throwaway LOCAL
// Mongo database (dropped first and afterwards) — refuses any non-local
// URI and never loads .env. Needs a local mongod, e.g.:
//
//   mongod --dbpath /tmp/mdb --port 27099 --fork --logpath /tmp/mdb.log
//   node scripts/testLandingFingerprint.js

const assert = require('assert');
const mongoose = require('mongoose');

const URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27099/intrafer_fingerprint_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) {
  console.error(`refusing non-local database: ${URI}`);
  process.exit(1);
}

const { neutralize, pageFingerprints, findDuplicates } = require('../src/utils/landingFingerprint');
const LandingPage = require('../src/models/LandingPage.model');
const ServiceCategory = require('../src/models/ServiceCategory.model');
const Place = require('../src/models/Place.model');
const User = require('../src/models/User.model');
const Vendor = require('../src/models/Vendor.model');
const { getLandingPages, getLandingPageById, bulkCreateLandingPages, updateLandingPage } = require('../src/controllers/landingPage.controller');

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`); }

// The shared template the live city pages were created from.
const TEMPLATE = {
  intro: 'Find the best {{category}} in {{city}}, {{state}}. {{vendorCount}} studios listed.',
  sections: [
    { type: 'text', title: 'Why hire a designer in {{city}}', body: 'Homes in {{city}} need careful planning.', enabled: true },
    { type: 'faq', title: 'FAQs', faqItems: [
      { question: 'How much does interior design cost in {{city}}?', answer: 'It depends on scope.' },
      { question: 'How long does a project take?', answer: 'Usually 8–12 weeks.' },
    ], enabled: true },
  ],
};
const CITIES = [['Pune', 'Maharashtra'], ['Mumbai', 'Maharashtra'], ['Nagpur', 'Maharashtra'], ['Bengaluru', 'Karnataka'],
  ['Mysuru', 'Karnataka'], ['Chennai', 'Tamil Nadu'], ['Hyderabad', 'Telangana'], ['Jaipur', 'Rajasthan']];
const CAT = { _id: new mongoose.Types.ObjectId(), name: 'Interior Designers' };
const page = (city, state, extra = {}) => ({
  _id: new mongoose.Types.ObjectId(), level: 'city', category: CAT, city, state, status: 'published',
  ...JSON.parse(JSON.stringify(TEMPLATE)), ...extra,
});
const names = (p) => ({ city: p.city, state: p.state, category: CAT.name });
const fp = (p) => pageFingerprints(p, names(p));

(async () => {
  // ── Pure ────────────────────────────────────────────────────────────
  await test('the 8 template pages (only the city swapped) share one fingerprint and are all flagged', async () => {
    const pages = CITIES.map(([c, s]) => page(c, s));
    assert.strictEqual(new Set(pages.map((p) => fp(p).full)).size, 1);
    const dup = findDuplicates(pages);
    for (const p of pages) {
      assert.strictEqual(dup.get(String(p._id)).sameText.length, 7, p.city);
      assert.strictEqual(dup.get(String(p._id)).sameFaq.length, 0, 'FAQ-only line excludes full duplicates');
    }
  });

  await test('placeholder-resolved text equality: a literal own city/state/category equals the placeholder version', async () => {
    const tokens = page('Pune', 'Maharashtra');
    const literal = page('Pune', 'Maharashtra', {
      intro: 'Find the best interior designers in PUNE, Maharashtra. {{vendorCount}} studios listed.',
      sections: [
        { type: 'text', title: 'Why hire a designer in Pune', body: 'Homes in Pune need   careful planning.', enabled: true },
        TEMPLATE.sections[1] && { ...JSON.parse(JSON.stringify(TEMPLATE.sections[1])), faqItems: [
          { question: 'How much does interior design cost in Pune?', answer: 'It depends on scope.' },
          { question: 'How long does a project take?', answer: 'Usually 8–12 weeks.' },
        ] },
      ],
    });
    assert.strictEqual(fp(literal).full, fp(tokens).full);
    // ...and equal to another city's template page.
    assert.strictEqual(fp(literal).full, fp(page('Jaipur', 'Rajasthan')).full);
  });

  await test('a page with edited (city-specific) FAQs is not flagged', async () => {
    const pages = CITIES.map(([c, s]) => page(c, s));
    pages[0].sections[1].faqItems = [{ question: 'Which Pune localities do studios cover?', answer: 'Kothrud, Baner and Viman Nagar.' }];
    const dup = findDuplicates(pages);
    assert.deepStrictEqual(dup.get(String(pages[0]._id)), { sameText: [], sameFaq: [] });
    assert.strictEqual(dup.get(String(pages[1]._id)).sameText.length, 6);
  });

  await test('FAQ-only line: same FAQ set (any order) but a different intro', async () => {
    const a = page('Pune', 'Maharashtra', { intro: 'Pune has a booming apartment market in Hinjewadi and Wakad.' });
    const b = page('Mumbai', 'Maharashtra');
    b.sections[1].faqItems.reverse();
    const dup = findDuplicates([a, b]);
    assert.deepStrictEqual(dup.get(String(a._id)).sameText, []);
    assert.deepStrictEqual(dup.get(String(a._id)).sameFaq.map((p) => p.city), ['Mumbai']);
  });

  await test('no false positives: pages differing in more than placeholders, empty drafts, other levels/categories', async () => {
    const a = page('Pune', 'Maharashtra');
    const b = page('Mumbai', 'Maharashtra', { intro: `${TEMPLATE.intro} Most Mumbai flats are compact.` });
    const c = page('Nagpur', 'Maharashtra');
    c.sections[0].body = 'Homes in {{city}} need careful planning for the summer heat.';
    const emptyA = page('Jaipur', 'Rajasthan', { intro: '', sections: [] });
    const emptyB = page('Chennai', 'Tamil Nadu', { intro: '', sections: [] });
    const otherCategory = page('Hyderabad', 'Telangana', { category: { _id: new mongoose.Types.ObjectId(), name: 'Interior Designers' } });
    const stateLevel = page('', 'Karnataka', { level: 'state' });
    const dup = findDuplicates([a, b, c, emptyA, emptyB, otherCategory, stateLevel]);
    for (const p of [a, b, c, emptyA, emptyB, otherCategory, stateLevel]) {
      assert.deepStrictEqual(dup.get(String(p._id)).sameText, [], p.city || p.level);
    }
    assert.strictEqual(fp(emptyA).full, null);
    // Literal numbers are kept: "3 BHK" doesn't collapse into {{vendorCount}}.
    const n3 = page('Pune', 'Maharashtra', { intro: 'Most homes here are 3 BHK.' });
    const n2 = page('Mumbai', 'Maharashtra', { intro: 'Most homes here are 2 BHK.' });
    assert.notStrictEqual(fp(n3).full, fp(n2).full);
  });

  await test('names are replaced as whole words only (no partial matches), longest first', async () => {
    assert.strictEqual(neutralize('Punekar families in Pune', { city: 'Pune' }), 'Punekar families in ⟦city⟧');
    assert.strictEqual(neutralize('Navi Mumbai, not Mumbai', { city: 'Navi Mumbai', state: 'Mumbai' }), '⟦city⟧, not ⟦state⟧');
    assert.strictEqual(neutralize('{{city}} {{bogus}} {{ vendorCount }}', {}), '⟦city⟧  ⟦count⟧');
  });

  // ── Endpoints (local DB) ────────────────────────────────────────────
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 3000 });
  } catch (err) {
    console.error(`cannot reach local Mongo at ${URI}: ${err.message}`);
    process.exit(1);
  }
  await mongoose.connection.db.dropDatabase();
  const cat = await ServiceCategory.create({ name: 'Interior Designers', slug: 'interior-designers', schemaOrgType: 'HomeAndConstructionBusiness' });
  const places = {};
  for (const [c, s] of CITIES) places[c] = await Place.create({ name: c, nameLower: c.toLowerCase(), state: s });
  // 3 vendors in Mumbai -> Mumbai (auto) is indexable; Jaipur is forced index.
  for (let i = 0; i < 3; i += 1) {
    const u = await User.create({ name: `V${i}`, email: `fp${i}@local.test`, passwordHash: 'x', role: 'vendor' });
    await Vendor.create({ userId: u._id, businessName: `Mumbai Studio ${i}`, isListingEnabled: true, primaryCategory: cat._id, location: { city: 'Mumbai', state: 'Maharashtra', placeId: places.Mumbai._id } });
  }
  const docs = [];
  for (const [c, s] of CITIES) {
    docs.push(await LandingPage.create({
      level: 'city', category: cat._id, city: c, state: s, status: c === 'Nagpur' ? 'draft' : 'published',
      ...JSON.parse(JSON.stringify(TEMPLATE)), seo: { indexing: c === 'Jaipur' ? 'index' : 'auto' },
    }));
  }
  const byCity = Object.fromEntries(docs.map((d) => [d.city, d]));

  const ADMIN = new mongoose.Types.ObjectId();
  const call = (handler, req) => new Promise((resolve, reject) => {
    const res = { statusCode: 200, locals: {}, status(code) { this.statusCode = code; return this; }, set() { return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; } };
    handler({ params: {}, query: {}, body: {}, user: { _id: ADMIN }, ...req }, res, (err) => (err ? reject(err) : resolve({ next: true })));
  });

  await test('GET /admin/landing-pages: every page carries duplicates (published and draft compared); indexable ones flagged', async () => {
    const { status, body } = await call(getLandingPages, { query: { limit: '50' } });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.pages.length, 8);
    for (const p of body.data.pages) {
      assert.strictEqual(p.duplicates.sameText.length, 7, p.city);
      assert.ok(p.duplicates.sameText.every((d) => d.city && d.status));
    }
    const ix = Object.fromEntries(body.data.pages.map((p) => [p.city, p.duplicates.indexable]));
    assert.deepStrictEqual([ix.Mumbai, ix.Jaipur, ix.Pune], [true, true, false]);
    assert.ok(body.data.pages.find((p) => p.city === 'Pune').duplicates.sameText.some((d) => d.city === 'Nagpur' && d.status === 'draft'));
  });

  await test('a filtered/paginated list still compares against every page of the category', async () => {
    const { body } = await call(getLandingPages, { query: { q: 'Pune' } });
    assert.strictEqual(body.data.pages.length, 1);
    assert.strictEqual(body.data.pages[0].duplicates.sameText.length, 7);
  });

  await test('GET /admin/landing-pages/:id returns duplicates; editing FAQs to be city-specific clears it (never blocks the save)', async () => {
    let { body } = await call(getLandingPageById, { params: { id: String(byCity.Pune._id) } });
    assert.strictEqual(body.data.duplicates.sameText.length, 7);
    const sections = JSON.parse(JSON.stringify(TEMPLATE.sections));
    sections[1].faqItems = [{ question: 'Which Pune localities are covered?', answer: 'Kothrud, Baner and Aundh.' }];
    sections[0].body = 'Pune homes range from Kothrud bungalows to Hinjewadi flats.';
    const saved = await call(updateLandingPage, { params: { id: String(byCity.Pune._id) }, body: { sections, intro: 'Pune designers who know Koregaon Park.' } });
    assert.strictEqual(saved.status, 200);
    ({ body } = await call(getLandingPageById, { params: { id: String(byCity.Pune._id) } }));
    assert.strictEqual(body.data.duplicates, null);
    ({ body } = await call(getLandingPageById, { params: { id: String(byCity.Mumbai._id) } }));
    assert.strictEqual(body.data.duplicates.sameText.length, 6);
  });

  await test('bulk create dry run lists the existing pages the template text already matches', async () => {
    const { status, body } = await call(bulkCreateLandingPages, { body: { templateId: String(byCity.Mumbai._id), dryRun: true, items: [{ state: 'Gujarat', city: 'Surat' }, { state: 'Gujarat', city: 'Vadodara' }] } });
    assert.strictEqual(status, 200);
    const t = body.data.textDuplicates;
    assert.strictEqual(t.inBatch, 1);
    assert.deepStrictEqual(t.existing.map((p) => p.city).sort(), ['Bengaluru', 'Chennai', 'Hyderabad', 'Jaipur', 'Mumbai', 'Mysuru', 'Nagpur']);
    assert.strictEqual(await LandingPage.countDocuments({ city: 'Surat' }), 0, 'dry run writes nothing');
  });

  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  console.log(`\n${passed} passed`);
})().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
