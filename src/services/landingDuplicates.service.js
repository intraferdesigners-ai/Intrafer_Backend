// Duplicate-text report for the admin (warn only). Computed here rather
// than in the admin UI because the admin list is paginated and filtered —
// the browser never holds every page of a level+category to compare — and
// the "indexable and duplicated" warning needs vendor counts, which only
// the backend has. Fingerprinting itself: utils/landingFingerprint.js.
const LandingPage = require('../models/LandingPage.model');
const Vendor = require('../models/Vendor.model');
const { findDuplicates, pageFingerprints, summarize } = require('../utils/landingFingerprint');
const { buildVendorFilter, computeIndexable } = require('./landingPage.service');

const FIELDS = 'level category state city stateSlug citySlug status intro sections seo.indexing';

const categoryIdOf = (p) => String(p.category?._id || p.category || '');

// Every page (any status) in the given categories, for comparison.
async function comparablePages(categoryIds) {
  if (!categoryIds.length) return [];
  const docs = await LandingPage.find({ category: { $in: categoryIds } }).select(FIELDS).populate('category', 'name');
  return docs.map((d) => (typeof d.toObject === 'function' ? d.toObject() : d));
}

// Whether the page is (or would be, if published) indexable: city pages by
// seo.indexing + the vendor threshold, hubs unless set to noindex.
async function isIndexable(page) {
  const level = page.level || 'city';
  const indexing = page.seo?.indexing || 'auto';
  let vendorCount = 0;
  if (level === 'city' && indexing === 'auto') {
    const { filter } = await buildVendorFilter(categoryIdOf(page), page.stateSlug, page.citySlug);
    vendorCount = await Vendor.countDocuments(filter);
  }
  return computeIndexable(level, indexing, vendorCount);
}

// { [pageId]: { sameText: [summary], sameFaq: [summary], indexable } } for
// the target pages that share text with at least one other page.
async function duplicateReport(targets) {
  const list = (targets || []).filter(Boolean);
  const all = await comparablePages([...new Set(list.map(categoryIdOf).filter(Boolean))]);
  const dup = findDuplicates(all);
  const report = {};
  for (const t of list) {
    const id = String(t._id);
    const d = dup.get(id);
    if (!d || (d.sameText.length === 0 && d.sameFaq.length === 0)) continue;
    const full = all.find((p) => String(p._id) === id) || t;
    report[id] = {
      sameText: d.sameText.map(summarize),
      sameFaq: d.sameFaq.map(summarize),
      indexable: await isIndexable(full),
    };
  }
  return report;
}

// Bulk create dry run: every new page copies the template's text, so each
// would share it with the template, with existing pages of the same text,
// and with every other page created in the batch.
async function templateDuplicateReport(template, categoryId, newCount) {
  if (!template) return null;
  const all = await comparablePages([String(categoryId)]);
  const own = all.find((p) => String(p._id) === String(template._id)) || template;
  const names = { city: own.city || '', state: own.state || '', category: own.category?.name || '' };
  const { full } = pageFingerprints(own, names);
  if (!full) return null;
  const sameCity = all.filter((p) => (p.level || 'city') === 'city' && categoryIdOf(p) === String(categoryId));
  const existing = sameCity.filter((p) => {
    const f = pageFingerprints(p, { city: p.city || '', state: p.state || '', category: p.category?.name || '' });
    return full && f.full === full;
  });
  return { existing: existing.map(summarize), inBatch: Math.max(0, newCount - 1) };
}

module.exports = { duplicateReport, templateDuplicateReport, isIndexable };
