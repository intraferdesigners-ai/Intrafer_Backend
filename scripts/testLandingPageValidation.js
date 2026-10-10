// Exercises LandingPage validation through the real create/update
// controllers: the CTA label/URL pair rule and the plain-English
// validation messages.
//
// Every DB call is stubbed, so this never connects to Mongo — and it
// deliberately does NOT load .env (which points at production).
//
//   node scripts/testLandingPageValidation.js

const assert = require('assert');
const mongoose = require('mongoose');
const LandingPage = require('../src/models/LandingPage.model');
const ServiceCategory = require('../src/models/ServiceCategory.model');
const { createLandingPage, updateLandingPage } = require('../src/controllers/landingPage.controller');

const PAIR = LandingPage.CTA_PAIR_MESSAGE;
const categoryId = new mongoose.Types.ObjectId();
const userId = new mongoose.Types.ObjectId();

ServiceCategory.exists = async () => ({ _id: categoryId });
LandingPage.exists = async () => null;
LandingPage.prototype.save = async function () { return this; };

function call(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    handler({ params: {}, user: { _id: userId }, ...req }, res, reject);
  });
}

const create = (extra) =>
  call(createLandingPage, { body: { category: String(categoryId), state: 'Delhi', city: 'Gaziabad', ...extra } });

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
  await check('CTA label only → 400, pair message on banner.ctaUrl', async () => {
    const r = await create({ banner: { ctaLabel: 'Get quotes' } });
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(r.body.errors, { 'banner.ctaUrl': PAIR });
    assert.strictEqual(r.body.message, PAIR);
  });

  await check('CTA URL only → 400, pair message on banner.ctaLabel', async () => {
    const r = await create({ banner: { ctaUrl: '/contact' } });
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(r.body.errors, { 'banner.ctaLabel': PAIR });
  });

  await check('CTA whitespace-only label + URL → 400 (label trims to empty)', async () => {
    const r = await create({ banner: { ctaLabel: '   ', ctaUrl: '/contact' } });
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(r.body.errors, { 'banner.ctaLabel': PAIR });
  });

  await check('CTA both set → 201', async () => {
    const r = await create({ banner: { ctaLabel: 'Get quotes', ctaUrl: '/contact' } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  });

  await check('CTA neither set → 201', async () => {
    const r = await create({ banner: { headline: 'Hello' } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  });

  await check('update: clearing CTA URL on a page that has both → 400', async () => {
    const existing = LandingPage.hydrate({
      _id: new mongoose.Types.ObjectId(),
      category: categoryId, state: 'Delhi', city: 'Gaziabad', stateSlug: 'delhi', citySlug: 'gaziabad',
      banner: { ctaLabel: 'Get quotes', ctaUrl: '/contact' },
    });
    const origFindById = LandingPage.findById;
    LandingPage.findById = async () => existing;
    try {
      const r = await call(updateLandingPage, { params: { id: String(existing._id) }, body: { banner: { ctaUrl: '' } } });
      assert.strictEqual(r.status, 400);
      assert.deepStrictEqual(r.body.errors, { 'banner.ctaUrl': PAIR });
    } finally {
      LandingPage.findById = origFindById;
    }
  });

  await check('metaTitle of 71 chars → "Meta title must be 70 characters or fewer."', async () => {
    const r = await create({ seo: { metaTitle: 'x'.repeat(71) } });
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(r.body.errors, { 'seo.metaTitle': 'Meta title must be 70 characters or fewer.' });
  });

  await check('vendorList.limit 51 → "Show between 1 and 50 vendors."', async () => {
    const r = await create({ vendorList: { limit: 51 } });
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(r.body.errors, { 'vendorList.limit': 'Show between 1 and 50 vendors.' });
  });

  await check('vendorList.limit 0 → "Show between 1 and 50 vendors."', async () => {
    const r = await create({ vendorList: { limit: 0 } });
    assert.deepStrictEqual(r.body.errors, { 'vendorList.limit': 'Show between 1 and 50 vendors.' });
  });

  await check('bad seo.indexing → "Choose a valid option."', async () => {
    const r = await create({ seo: { indexing: 'sometimes' } });
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(r.body.errors, { 'seo.indexing': 'Choose a valid option.' });
  });

  await check('errors-map keys unchanged (nested section paths, several fields at once)', async () => {
    const r = await create({
      status: 'live',
      banner: { headline: 'h'.repeat(121) },
      sections: [{ type: 'text', title: 't' }, { type: 'text', title: 't'.repeat(121), body: 'b'.repeat(5001) }],
    });
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(r.body.errors, {
      status: 'Choose a valid option.',
      'banner.headline': 'Banner headline must be 120 characters or fewer.',
      'sections.1.title': 'Section title must be 120 characters or fewer.',
      'sections.1.body': 'Section body must be 5000 characters or fewer.',
    });
  });

  await check('custom messages pass through unchanged (https URL)', async () => {
    const r = await create({ banner: { imageUrl: 'http://example.com/a.jpg' } });
    assert.deepStrictEqual(r.body.errors, { 'banner.imageUrl': 'banner.imageUrl must be an https:// URL.' });
  });

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
