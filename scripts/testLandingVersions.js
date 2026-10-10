// Landing page version history (Phase 4B): the service, the hooks in the
// real controllers, and the read endpoints.
//
// Every DB call is stubbed with in-memory stores, so this never connects
// to Mongo — and it deliberately does NOT load .env (which points at
// production).
//
//   node scripts/testLandingVersions.js

const assert = require('assert');
const mongoose = require('mongoose');

mongoose.set('bufferCommands', false); // an unstubbed DB call fails fast instead of hanging

const landingService = require('../src/services/landingPage.service');
landingService.resolvePlaceWithAliases = async () => null;

const LandingPage = require('../src/models/LandingPage.model');
const LandingPageVersion = require('../src/models/LandingPageVersion.model');
const ServiceCategory = require('../src/models/ServiceCategory.model');
const versionService = require('../src/services/landingPageVersion.service');
const {
  createLandingPage, updateLandingPage, deleteLandingPage, duplicateLandingPage,
  bulkCreateLandingPages, bulkLandingPageAction, getLandingPageVersions, getLandingPageVersion,
} = require('../src/controllers/landingPage.controller');

const { snapshotOf, changedKeys, recordVersion, MAX_VERSIONS } = versionService;
const realRecordVersion = recordVersion;

const CAT = new mongoose.Types.ObjectId();
const ADMIN = new mongoose.Types.ObjectId();
const ADMIN_NAMES = { [String(ADMIN)]: 'Asha Admin' };
const eq = (a, b) => String(a) === String(b);
const plain = (o) => JSON.parse(JSON.stringify(o));

// ── In-memory stores ─────────────────────────────────────────────────────
let pages = [];
let versions = [];
let clock = Date.parse('2026-10-01T00:00:00Z');

// Chainable query over `rows` (sort newest first by createdAt then _id,
// skip, select('-snapshot'), populate('savedBy')).
function query(rows, { single = false, hydrate = null } = {}) {
  let out = [...rows];
  let dropSnapshot = false;
  let populateSavedBy = false;
  const q = {
    sort: () => { out.sort((a, b) => (b.createdAt - a.createdAt) || String(b._id).localeCompare(String(a._id))); return q; },
    skip: (n) => { out = out.slice(n); return q; },
    select: (fields) => { if (fields === '-snapshot') dropSnapshot = true; return q; },
    populate: (path) => { if (path === 'savedBy') populateSavedBy = true; return q; },
    then: (ok, ko) => {
      let rowsOut = out.map((r) => {
        const v = { ...r };
        if (dropSnapshot) delete v.snapshot;
        if (populateSavedBy && v.savedBy) v.savedBy = { _id: v.savedBy, name: ADMIN_NAMES[String(v.savedBy)] };
        return hydrate ? hydrate(v) : v;
      });
      return Promise.resolve(single ? (rowsOut[0] || null) : rowsOut).then(ok, ko);
    },
  };
  return q;
}
const vMatch = (v, f) => (!f.page || eq(v.page, f.page)) && (!f._id || (f._id.$in ? f._id.$in.some((x) => eq(x, v._id)) : eq(v._id, f._id)));

LandingPageVersion.findOne = (f) => query(versions.filter((v) => vMatch(v, f)), { single: true });
LandingPageVersion.find = (f) => query(versions.filter((v) => vMatch(v, f)));
LandingPageVersion.exists = async (f) => versions.find((v) => vMatch(v, f)) ? { _id: versions.find((v) => vMatch(v, f))._id } : null;
LandingPageVersion.create = async (doc) => {
  const v = { ...doc, _id: new mongoose.Types.ObjectId(), createdAt: new Date(clock += 1000) };
  versions.push(v);
  return v;
};
LandingPageVersion.deleteMany = async (f) => {
  versions = versions.filter((v) => !(f.page?.$in ? f.page.$in.some((x) => eq(x, v.page)) : vMatch(v, f)));
};

const hydratePage = (o) => LandingPage.hydrate(plain(o));
LandingPage.findById = (id) => query(pages.filter((p) => eq(p._id, id)), { single: true, hydrate: hydratePage });
LandingPage.find = (f) => query(pages.filter((p) => (!f._id?.$in || f._id.$in.some((x) => eq(x, p._id)))
  && (!f.category || eq(p.category, f.category)) && (!f.stateSlug?.$in || f.stateSlug.$in.includes(p.stateSlug))), { hydrate: hydratePage });
LandingPage.exists = async (f) => pages.find((p) => (f._id && !f._id.$ne ? eq(p._id, f._id) : !eq(p._id, f._id?.$ne)
  && eq(p.category, f.category) && p.stateSlug === f.stateSlug && p.citySlug === f.citySlug)) || null;
LandingPage.findByIdAndDelete = async (id) => {
  const p = pages.find((x) => eq(x._id, id));
  pages = pages.filter((x) => !eq(x._id, id));
  return p ? hydratePage(p) : null;
};
LandingPage.deleteOne = async ({ _id }) => { pages = pages.filter((p) => !eq(p._id, _id)); };
LandingPage.prototype.save = async function save(options = {}) {
  if (options.validateBeforeSave !== false) await this.validate();
  const o = plain(this.toObject());
  pages = pages.filter((p) => !eq(p._id, o._id)).concat(o);
  return this;
};
ServiceCategory.exists = async (f) => (eq(f._id, CAT) ? { _id: CAT } : null);
ServiceCategory.findById = () => query([{ _id: CAT, name: 'Interior Designers' }], { single: true });

function call(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      locals: {},
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    handler({ params: {}, body: {}, user: { _id: ADMIN }, ...req }, res, reject);
  });
}
const versionsOf = (id) => versions.filter((v) => eq(v.page, id))
  .sort((a, b) => (b.createdAt - a.createdAt) || String(b._id).localeCompare(String(a._id)));
const create = async (extra = {}) => {
  const r = await call(createLandingPage, { body: { category: String(CAT), state: 'Maharashtra', city: `City ${pages.length + 1}`, ...extra } });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  return String(r.body.data.page._id);
};
const put = (id, body, user = { _id: ADMIN }) => call(updateLandingPage, { params: { id }, body, user });

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
  // ── Pure helpers ───────────────────────────────────────────────────────
  await check('snapshotOf: only the six content keys; no location/status/slugs; section & FAQ ids stripped', async () => {
    const doc = new LandingPage({
      category: CAT, state: 'Goa', city: 'Panaji', status: 'published',
      heading: 'H', sections: [{ type: 'faq', title: 'F', faqItems: [{ question: 'Q?', answer: 'A' }] }],
    });
    await doc.validate();
    const snap = snapshotOf(doc);
    assert.deepStrictEqual(Object.keys(snap).sort(), ['banner', 'heading', 'intro', 'sections', 'seo', 'vendorList']);
    const json = JSON.stringify(snap);
    for (const banned of ['"_id"', '"__v"', 'Panaji', 'panaji', '"status"', 'published', 'stateSlug', 'category']) {
      assert.ok(!json.includes(banned), `snapshot contains ${banned}`);
    }
    assert.deepStrictEqual(snap.sections[0].faqItems, [{ question: 'Q?', answer: 'A' }]);
  });

  await check('changedKeys: deep, key-order independent; first version = non-empty keys', () => {
    const a = { banner: { headline: 'x', imageUrl: '' }, heading: 'h', intro: '', sections: [], vendorList: { sort: 'featured', limit: 12 }, seo: { metaTitle: '', indexing: 'auto' } };
    const reordered = { ...a, banner: { imageUrl: '', headline: 'x' }, vendorList: { limit: 12, sort: 'featured' } };
    assert.deepStrictEqual(changedKeys(a, reordered), []);
    assert.deepStrictEqual(changedKeys(a, { ...a, intro: 'new', seo: { metaTitle: 'm', indexing: 'auto' } }), ['intro', 'seo']);
    assert.deepStrictEqual(changedKeys(a, { ...a, sections: [{ type: 'text', title: 't' }] }), ['sections']);
    assert.deepStrictEqual(changedKeys(null, a), ['banner', 'heading', 'vendorList', 'seo']);
  });

  // ── Recording through the handlers ─────────────────────────────────────
  let pageId;
  await check('create → "create" version listing the non-empty keys', async () => {
    pageId = await create({ heading: 'Hello', banner: { headline: 'Big' } });
    const [v] = versionsOf(pageId);
    assert.strictEqual(versionsOf(pageId).length, 1);
    assert.strictEqual(v.kind, 'create');
    assert.deepStrictEqual(v.changedFields, ['banner', 'heading', 'vendorList', 'seo']);
    assert.ok(eq(v.savedBy, ADMIN));
    assert.strictEqual(v.snapshot.heading, 'Hello');
  });

  await check('save with a change → "save" + changedFields; identical save → nothing', async () => {
    await put(pageId, { intro: 'Some intro' });
    assert.strictEqual(versionsOf(pageId)[0].kind, 'save');
    assert.deepStrictEqual(versionsOf(pageId)[0].changedFields, ['intro']);
    const before = versionsOf(pageId).length;
    const r = await put(pageId, { intro: 'Some intro' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(versionsOf(pageId).length, before, 'no-op save created a version');
  });

  await check('publish with no content change is still recorded; content+status → status kind with new content', async () => {
    let r = await put(pageId, { status: 'published' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(versionsOf(pageId)[0].kind, 'publish');
    assert.deepStrictEqual(versionsOf(pageId)[0].changedFields, []);
    r = await put(pageId, { status: 'draft', heading: 'Changed while unpublishing' });
    assert.strictEqual(versionsOf(pageId)[0].kind, 'unpublish');
    assert.deepStrictEqual(versionsOf(pageId)[0].changedFields, ['heading']);
    assert.strictEqual(versionsOf(pageId)[0].snapshot.heading, 'Changed while unpublishing');
  });

  await check('unpublish fast path ({ status: "draft" }) records "unpublish" with the stored content; already draft → nothing', async () => {
    await put(pageId, { status: 'published' });
    const stored = pages.find((p) => eq(p._id, pageId));
    await put(pageId, { status: 'draft' });
    const [v] = versionsOf(pageId);
    assert.strictEqual(v.kind, 'unpublish');
    assert.strictEqual(v.snapshot.heading, stored.heading);
    const before = versionsOf(pageId).length;
    await put(pageId, { status: 'draft' });
    assert.strictEqual(versionsOf(pageId).length, before);
  });

  await check('restore: own version → kind "restore" + restoredFrom; foreign or invalid id ignored; never stored on the page', async () => {
    const oldest = versionsOf(pageId).at(-1);
    let r = await put(pageId, { heading: 'Hello', intro: '', restoredFrom: String(oldest._id) });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(versionsOf(pageId)[0].kind, 'restore');
    assert.ok(eq(versionsOf(pageId)[0].restoredFrom, oldest._id));

    const otherId = await create();
    const foreign = versionsOf(otherId)[0];
    r = await put(pageId, { heading: 'Foreign', restoredFrom: String(foreign._id) });
    assert.strictEqual(versionsOf(pageId)[0].kind, 'save');
    assert.strictEqual(versionsOf(pageId)[0].restoredFrom, null);
    r = await put(pageId, { heading: 'Invalid', restoredFrom: 'not-an-id' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(versionsOf(pageId)[0].kind, 'save');
    for (const p of pages) assert.ok(!('restoredFrom' in p), 'restoredFrom stored on a page');
  });

  await check(`pruning keeps exactly the ${MAX_VERSIONS} newest`, async () => {
    for (let i = 0; i < 15; i += 1) await put(pageId, { intro: `rev ${i}` });
    const kept = versionsOf(pageId);
    assert.strictEqual(kept.length, MAX_VERSIONS);
    assert.strictEqual(kept[0].snapshot.intro, 'rev 14');
    assert.strictEqual(kept[MAX_VERSIONS - 1].snapshot.intro, 'rev 5');
  });

  await check('a failing version store never breaks the save (recordVersion swallows; handler guards a throwing recorder)', async () => {
    const realCreate = LandingPageVersion.create;
    LandingPageVersion.create = async () => { throw new Error('db down'); };
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.strictEqual(await realRecordVersion(pages.find((p) => eq(p._id, pageId)) && LandingPage.hydrate(plain(pages.find((p) => eq(p._id, pageId)))), { kind: 'publish' }), null);
      let r = await put(pageId, { intro: 'saved while history is down' });
      assert.strictEqual(r.status, 200);
      versionService.recordVersion = () => { throw new Error('sync boom'); };
      r = await put(pageId, { intro: 'and again' });
      assert.strictEqual(r.status, 200);
      versionService.recordVersion = async () => { throw new Error('async boom'); };
      r = await put(pageId, { intro: 'and once more' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(pages.find((p) => eq(p._id, pageId)).intro, 'and once more');
    } finally {
      LandingPageVersion.create = realCreate;
      versionService.recordVersion = realRecordVersion;
      console.error = quiet;
    }
  });

  await check('a failed (400) save records nothing', async () => {
    const before = versionsOf(pageId).length;
    const r = await put(pageId, { banner: { ctaLabel: 'Only a label' } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(versionsOf(pageId).length, before);
  });

  // ── Other writers ──────────────────────────────────────────────────────
  await check('duplicate → "duplicate" on the NEW page; bulk create → "bulk_create" per page', async () => {
    const r = await call(duplicateLandingPage, { params: { id: pageId }, body: { state: 'Goa', city: 'Margao' } });
    assert.strictEqual(r.status, 201);
    const newId = String(r.body.data.page._id);
    assert.deepStrictEqual(versionsOf(newId).map((v) => v.kind), ['duplicate']);
    const b = await call(bulkCreateLandingPages, { body: { templateId: pageId, items: [{ state: 'Goa', city: 'Vasco' }, { state: 'Goa', city: 'Mapusa' }] } });
    const ids = b.body.data.results.map((x) => String(x.pageId));
    for (const id of ids) assert.deepStrictEqual(versionsOf(id).map((v) => v.kind), ['bulk_create']);
  });

  await check('bulk publish/unpublish record per changed page, not for "unchanged"', async () => {
    const a = await create();
    const bId = await create();
    await call(bulkLandingPageAction, { body: { ids: [a, bId], action: 'publish' } });
    assert.strictEqual(versionsOf(a)[0].kind, 'publish');
    const count = versionsOf(a).length;
    await call(bulkLandingPageAction, { body: { ids: [a], action: 'publish' } }); // unchanged
    assert.strictEqual(versionsOf(a).length, count);
    await call(bulkLandingPageAction, { body: { ids: [a], action: 'unpublish' } });
    assert.strictEqual(versionsOf(a)[0].kind, 'unpublish');
  });

  await check('deleting a page (single or bulk) deletes its versions', async () => {
    const a = await create();
    const bId = await create();
    assert.ok(versionsOf(a).length && versionsOf(bId).length);
    await call(deleteLandingPage, { params: { id: a } });
    await call(bulkLandingPageAction, { body: { ids: [bId], action: 'delete' } });
    assert.strictEqual(versionsOf(a).length, 0);
    assert.strictEqual(versionsOf(bId).length, 0);
  });

  // ── Read endpoints ─────────────────────────────────────────────────────
  await check('GET versions: newest first, no snapshots, savedBy name; 404 missing/invalid page', async () => {
    const r = await call(getLandingPageVersions, { params: { id: pageId } });
    assert.strictEqual(r.status, 200);
    const list = r.body.data.versions;
    assert.strictEqual(list.length, MAX_VERSIONS);
    assert.ok(list.every((v) => !('snapshot' in v)));
    assert.deepStrictEqual(Object.keys(list[0]).sort(), ['changedFields', 'createdAt', 'id', 'kind', 'restoredFrom', 'savedBy']);
    assert.deepStrictEqual(list[0].savedBy, { name: 'Asha Admin' });
    assert.ok(list.every((v, i) => i === 0 || list[i - 1].createdAt >= v.createdAt));
    assert.strictEqual((await call(getLandingPageVersions, { params: { id: String(new mongoose.Types.ObjectId()) } })).status, 404);
    assert.strictEqual((await call(getLandingPageVersions, { params: { id: 'nope' } })).status, 404);
  });

  await check('GET one version: snapshot included; 404 when it belongs to another page or ids are invalid', async () => {
    const v = versionsOf(pageId)[0];
    const r = await call(getLandingPageVersion, { params: { id: pageId, versionId: String(v._id) } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.data.version.snapshot.intro, v.snapshot.intro);
    assert.strictEqual(r.body.data.version.kind, v.kind);
    const otherId = await create();
    assert.strictEqual((await call(getLandingPageVersion, { params: { id: otherId, versionId: String(v._id) } })).status, 404);
    assert.strictEqual((await call(getLandingPageVersion, { params: { id: pageId, versionId: 'x' } })).status, 404);
  });

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
