const mongoose = require('mongoose');
const LandingPage = require('../models/LandingPage.model');
const ServiceCategory = require('../models/ServiceCategory.model');
const Vendor = require('../models/Vendor.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const paginate = require('../utils/paginate');
const { slugify } = require('../utils/slug');
const { getFileUrl } = require('../middleware/upload');
const { resolveCategory } = require('../utils/resolveTaxonomy');
const { attachCardImages } = require('./public.controller');
const {
  VENDOR_SORT, buildVendorFilter, placeFilter, nameFilter,
  computeIndexable, resolvePlaceWithAliases, isSimilarSlug,
} = require('../services/landingPage.service');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Body fields an admin may write. Slugs, publishedAt and
// createdBy/updatedBy are always derived server-side.
const EDITABLE_FIELDS = [
  'level', 'category', 'state', 'city', 'status',
  'banner', 'heading', 'intro', 'sections', 'vendorList', 'seo',
];

const pickEditable = (body = {}) => {
  const out = {};
  for (const key of EDITABLE_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};

const duplicateMessage = (page) =>
  `A landing page for ${page.city || '(all cities)'}, ${page.state || '(all states)'} already exists in this category.`;

// Pre-checks the unique (category, stateSlug, citySlug) key so the admin
// gets a clear 409 instead of errorHandler's generic "category already in
// use"; the E11000 catch in save() below covers the race between check
// and write.
//
// Validation failures are answered here too, with a per-field `errors` map
// ({ 'seo.metaTitle': '...', 'sections.0.title': '...' }) alongside the
// usual joined message, so the editor can show each next to its field.
async function saveWithDuplicateCheck(res, page) {
  try {
    await page.validate();
  } catch (err) {
    if (err.name !== 'ValidationError') throw err;
    const errors = {};
    for (const [path, e] of Object.entries(err.errors)) {
      // Cast/nested errors repeat on parent paths (e.g. 'sections' and
      // 'sections.0.type') — keep only the most specific ones.
      if (!Object.keys(err.errors).some((other) => other.startsWith(`${path}.`))) errors[path] = e.message;
    }
    return error(res, Object.values(errors).join(', '), 400, errors);
  }
  const clash = await LandingPage.exists({
    _id: { $ne: page._id },
    category: page.category,
    stateSlug: page.stateSlug,
    citySlug: page.citySlug,
  });
  if (clash) return error(res, duplicateMessage(page), 409);
  try {
    await page.save();
  } catch (err) {
    if (err.code === 11000) return error(res, duplicateMessage(page), 409);
    throw err;
  }
  return null;
}

// ── Admin ────────────────────────────────────────────────────────────────

const getLandingPages = catchAsync(async (req, res) => {
  const { category, status, q } = req.query;
  const filter = {};
  if (category) {
    if (!mongoose.isValidObjectId(category)) return error(res, 'Invalid category.', 400);
    filter.category = category;
  }
  if (status) filter.status = status;
  if (q && q.trim()) {
    const re = new RegExp(escapeRegex(q.trim()), 'i');
    filter.$or = [{ state: re }, { city: re }];
  }

  const total = await LandingPage.countDocuments(filter);
  const { skip, limit, page, totalPages } = paginate(req.query, total);

  const pages = await LandingPage.find(filter)
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('category', 'name slug')
    .populate('updatedBy', 'name');

  return success(res, { pages, total, page, totalPages });
});

const getLandingPageById = catchAsync(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return error(res, 'Landing page not found.', 404);
  const page = await LandingPage.findById(req.params.id)
    .populate('category', 'name slug')
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email');
  if (!page) return error(res, 'Landing page not found.', 404);
  return success(res, { page });
});

const createLandingPage = catchAsync(async (req, res) => {
  const data = pickEditable(req.body);
  if (!data.category || !data.state || !data.city) {
    return error(res, 'category, state and city are required.', 400);
  }
  if (!mongoose.isValidObjectId(data.category) || !(await ServiceCategory.exists({ _id: data.category }))) {
    return error(res, 'Category not found.', 400);
  }

  const page = new LandingPage({ ...data, createdBy: req.user._id, updatedBy: req.user._id });
  const failed = await saveWithDuplicateCheck(res, page);
  if (failed) return failed;

  return success(res, { page }, 'Landing page created.', 201);
});

const updateLandingPage = catchAsync(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return error(res, 'Landing page not found.', 404);
  const page = await LandingPage.findById(req.params.id);
  if (!page) return error(res, 'Landing page not found.', 404);

  const data = pickEditable(req.body);
  if (data.category !== undefined) {
    if (!mongoose.isValidObjectId(data.category) || !(await ServiceCategory.exists({ _id: data.category }))) {
      return error(res, 'Category not found.', 400);
    }
  }

  // Nested objects are merged rather than replaced, so a PUT of
  // { seo: { metaTitle } } doesn't reset seo.indexing to its default.
  for (const [key, value] of Object.entries(data)) {
    if (['banner', 'vendorList', 'seo'].includes(key) && value && typeof value === 'object') {
      for (const [subKey, subValue] of Object.entries(value)) page.set(`${key}.${subKey}`, subValue);
    } else {
      page.set(key, value);
    }
  }
  page.updatedBy = req.user._id;

  const failed = await saveWithDuplicateCheck(res, page);
  if (failed) return failed;

  return success(res, { page }, 'Landing page updated.');
});

// Hard delete — the URL then falls back to the automatic page, which is
// the intended behavior.
const deleteLandingPage = catchAsync(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return error(res, 'Landing page not found.', 404);
  const page = await LandingPage.findByIdAndDelete(req.params.id);
  if (!page) return error(res, 'Landing page not found.', 404);
  return success(res, {}, 'Landing page deleted.');
});

// Active service categories for the editor's category dropdown and the list
// filter — create/list take a category ObjectId, and the only other admin
// category endpoint (/admin/categories) serves the older Category model.
const getLandingPageCategories = catchAsync(async (req, res) => {
  const categories = await ServiceCategory.find({ isActive: true }).select('_id slug name').sort({ name: 1 });
  return success(res, { categories });
});

const uploadLandingPageImage = (req, res) => {
  if (!req.file) return error(res, 'No file uploaded.', 400);
  return success(res, { url: getFileUrl(req.file) }, 'Uploaded successfully.');
};

// Editor hint + duplicate warning. Never blocks — only informs.
// `category` is an ObjectId (or a slug); state/city are free text or slugs.
// `excludeId` leaves the page being edited out of `similar`.
const matchCheck = catchAsync(async (req, res) => {
  const { category, state, city, excludeId } = req.query;
  if (!category || !state || !city) return error(res, 'category, state and city are required.', 400);

  const serviceCategory = mongoose.isValidObjectId(category)
    ? await ServiceCategory.findById(category)
    : await ServiceCategory.findOne({ slug: category });
  if (!serviceCategory) return error(res, 'Category not found.', 404);

  const stateSlug = slugify(String(state));
  const citySlug = slugify(String(city));
  if (!stateSlug || !citySlug) return error(res, 'state and city must contain letters or digits.', 400);

  const { matchedPlace } = await buildVendorFilter(serviceCategory._id, stateSlug, citySlug);
  const [vendorsByPlace, vendorsByName] = await Promise.all([
    matchedPlace ? Vendor.countDocuments(placeFilter(serviceCategory._id, matchedPlace._id)) : 0,
    Vendor.countDocuments(nameFilter(serviceCategory._id, stateSlug, citySlug)),
  ]);

  const candidates = await LandingPage.find({
    category: serviceCategory._id,
    stateSlug,
    ...(excludeId && mongoose.isValidObjectId(excludeId) ? { _id: { $ne: excludeId } } : {}),
  }).select('state city stateSlug citySlug status level');

  const aliasPlace = await resolvePlaceWithAliases(stateSlug, citySlug);
  const similar = [];
  for (const candidate of candidates) {
    let reason = null;
    if (candidate.citySlug === citySlug) {
      reason = 'same-slug';
    } else if (isSimilarSlug(candidate.citySlug, citySlug)) {
      reason = 'similar-name';
    } else if (aliasPlace && candidate.citySlug) {
      const candidatePlace = await resolvePlaceWithAliases(candidate.stateSlug, candidate.citySlug);
      if (candidatePlace && candidatePlace._id.equals(aliasPlace._id)) reason = 'same-place';
    }
    if (reason) {
      similar.push({
        _id: candidate._id,
        state: candidate.state,
        city: candidate.city,
        citySlug: candidate.citySlug,
        status: candidate.status,
        reason,
      });
    }
  }

  return success(res, {
    matchedPlace: matchedPlace ? matchedPlace.name : null,
    vendorsByPlace,
    vendorsByName,
    similar,
  });
});

// ── Public ───────────────────────────────────────────────────────────────

const PUBLIC_OMIT = '-createdBy -updatedBy -__v';

// Lookup is by (category, stateSlug, citySlug) ONLY — never through
// Place — so a published page for a free-text city still resolves.
// Returns page:null for no record or a draft; vendors/indexable are
// computed either way, using the default vendorList/seo settings when
// there's no page.
const getPublicLandingPage = catchAsync(async (req, res) => {
  const { category, state, city } = req.query;
  if (!category || !state || !city) return error(res, 'category, state and city are required.', 400);

  const serviceCategory = await resolveCategory(category);
  if (!serviceCategory) return error(res, 'Category not found.', 404);

  const stateSlug = slugify(String(state));
  const citySlug = slugify(String(city));
  if (!stateSlug || !citySlug) return error(res, 'Invalid state or city.', 400);

  const page = await LandingPage.findOne({
    category: serviceCategory._id,
    stateSlug,
    citySlug,
    status: 'published',
  })
    .select(PUBLIC_OMIT)
    .populate('category', 'name slug schemaOrgType');

  const sort = page?.vendorList?.sort || 'featured';
  const limit = page?.vendorList?.limit || 12;
  const indexing = page?.seo?.indexing || 'auto';

  const { filter } = await buildVendorFilter(serviceCategory._id, stateSlug, citySlug);
  const vendorCount = await Vendor.countDocuments(filter);
  const vendors = await Vendor.find(filter)
    .sort(VENDOR_SORT[sort] || VENDOR_SORT.featured)
    .limit(limit)
    .populate('userId', 'name');

  return success(res, {
    page: page || null,
    vendors: await attachCardImages(vendors),
    vendorCount,
    indexable: computeIndexable(indexing, vendorCount),
  });
});

// Published pages for the Phase 2 sitemap. Pages whose category is gone
// or inactive are skipped — their URLs 404 anyway.
const getLandingPagesSitemap = catchAsync(async (req, res) => {
  const pages = await LandingPage.find({ status: 'published', level: 'city' })
    .select('category stateSlug citySlug updatedAt seo.indexing')
    .populate('category', 'slug isActive')
    .sort({ updatedAt: -1 });

  const entries = [];
  for (const p of pages) {
    if (!p.category || !p.category.isActive) continue;
    const { filter } = await buildVendorFilter(p.category._id, p.stateSlug, p.citySlug);
    const vendorCount = await Vendor.countDocuments(filter);
    entries.push({
      categorySlug: p.category.slug,
      stateSlug: p.stateSlug,
      citySlug: p.citySlug,
      updatedAt: p.updatedAt,
      indexable: computeIndexable(p.seo?.indexing || 'auto', vendorCount),
    });
  }

  return success(res, { pages: entries });
});

module.exports = {
  getLandingPages, getLandingPageById, createLandingPage, updateLandingPage, deleteLandingPage, matchCheck,
  getLandingPageCategories, uploadLandingPageImage,
  getPublicLandingPage, getLandingPagesSitemap,
};
