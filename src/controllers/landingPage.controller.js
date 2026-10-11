const mongoose = require('mongoose');
const LandingPage = require('../models/LandingPage.model');
const LandingPageVersion = require('../models/LandingPageVersion.model');
const versionService = require('../services/landingPageVersion.service');
const ServiceCategory = require('../models/ServiceCategory.model');
const Vendor = require('../models/Vendor.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const paginate = require('../utils/paginate');
const { slugify } = require('../utils/slug');
const { getFileUrl } = require('../middleware/upload');
const { resolveCategory } = require('../utils/resolveTaxonomy');
const { attachCardImages } = require('./public.controller');
const { signPreviewToken, verifyPreviewToken } = require('../utils/landingPreviewToken');
const {
  copyContent, normaliseLocation, findSourceMentions, MAX_LOCATION_LENGTH,
} = require('../utils/landingPageCopy');
const {
  VENDOR_SORT, buildVendorFilter, buildStateVendorFilter, buildCategoryVendorFilter, placeFilter, nameFilter,
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

// Phase 4C: a page is a category hub, a state hub or a city page. Docs
// written before `level` was used are city pages.
const LEVELS = ['category', 'state', 'city'];
const levelOf = (page) => page?.level || 'city';
const isHub = (level) => level === 'category' || level === 'state';

// The vendor filter for a page of `level` — the city page's Place-or-name
// match, or the hub scopes (services/landingPage.service.js).
async function scopeFilter(level, categoryId, stateSlug, citySlug) {
  if (level === 'category') return buildCategoryVendorFilter(categoryId);
  if (level === 'state') return buildStateVendorFilter(categoryId, stateSlug);
  return buildVendorFilter(categoryId, stateSlug, citySlug);
}

// The page's public path, trailing slash included.
function publicPath(level, categorySlug, stateSlug, citySlug) {
  if (level === 'category') return `/${categorySlug}/`;
  if (level === 'state') return `/${categorySlug}/${stateSlug}/`;
  return `/${categorySlug}/${stateSlug}/${citySlug}/`;
}

const duplicateMessage = (page) => {
  if (page.level === 'category') return 'A category page already exists for this category.';
  if (page.level === 'state') return `A landing page for ${page.state} already exists in this category.`;
  return `A landing page for ${page.city || '(all cities)'}, ${page.state || '(all states)'} already exists in this category.`;
};

// Plain-English names for schema paths, keyed with array indexes
// collapsed to `N` (see validationMessage).
const FIELD_LABELS = {
  state: 'State',
  city: 'City',
  category: 'Category',
  'banner.imageUrl': 'Banner image URL',
  'banner.headline': 'Banner headline',
  'banner.subheadline': 'Banner subheadline',
  'banner.ctaLabel': 'CTA label',
  'banner.ctaUrl': 'CTA URL',
  heading: 'Heading',
  intro: 'Intro',
  'sections.N.title': 'Section title',
  'sections.N.body': 'Section body',
  'sections.N.faqItems.N.question': 'FAQ question',
  'sections.N.faqItems.N.answer': 'FAQ answer',
  'sections.N.localities.N': 'Locality name',
  'seo.metaTitle': 'Meta title',
  'seo.metaDescription': 'Meta description',
  'seo.ogImage': 'OG image URL',
};

// Rewrites Mongoose's built-in validator messages ("Path `seo.metaTitle`
// (`...`) is longer than the maximum allowed length (70).") for the
// admin. Custom messages (https URL, section/FAQ/locality caps, the CTA
// pair rule) aren't one of these kinds and pass through unchanged.
function validationMessage(path, e) {
  const key = path.replace(/\.\d+(?=\.|$)/g, '.N');
  if (key === 'vendorList.limit' && (e.kind === 'min' || e.kind === 'max')) {
    const { min, max } = LandingPage.schema.path('vendorList.limit').options;
    return `Show between ${min} and ${max} vendors.`;
  }
  if (e.kind === 'enum') return 'Choose a valid option.';
  const label = FIELD_LABELS[key];
  if (!label) return e.message;
  switch (e.kind) {
    case 'maxlength': return `${label} must be ${e.properties.maxlength} characters or fewer.`;
    case 'max': return `${label} must be ${e.properties.max} or less.`;
    case 'min': return `${label} must be ${e.properties.min} or more.`;
    case 'required': return `${label} is required.`;
    default: return e.message;
  }
}

// Pre-checks the unique (category, stateSlug, citySlug) key so the admin
// gets a clear 409 instead of errorHandler's generic "category already in
// use"; the E11000 catch in save() below covers the race between check
// and write.
//
// Validation failures are answered here too, with a per-field `errors` map
// ({ 'seo.metaTitle': '...', 'sections.0.title': '...' }) alongside the
// usual joined message, so the editor can show each next to its field.
// ValidationError -> { path: plain-English message }. Cast/nested errors
// repeat on parent paths (e.g. 'sections' and 'sections.0.type') — keep
// only the most specific ones.
function validationErrors(err) {
  const errors = {};
  for (const [path, e] of Object.entries(err.errors)) {
    if (!Object.keys(err.errors).some((other) => other.startsWith(`${path}.`))) errors[path] = validationMessage(path, e);
  }
  return errors;
}

async function saveWithDuplicateCheck(res, page) {
  try {
    await page.validate();
  } catch (err) {
    if (err.name !== 'ValidationError') throw err;
    const errors = validationErrors(err);
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

// Version history (Phase 4B). Called only AFTER a successful save, with
// the saved document. recordVersion already swallows its own errors; this
// guard makes sure nothing it does can ever fail the request.
async function recordSafely(page, opts) {
  try {
    await versionService.recordVersion(page, opts);
  } catch (err) {
    console.error('Landing page version not recorded:', err.message);
  }
}

// body.restoredFrom -> that version's id when it's a version of THIS
// page, else null (silently: a foreign/invalid id is just ignored).
async function validRestoredFrom(value, pageId) {
  if (!value || !mongoose.isValidObjectId(value)) return null;
  const owned = await LandingPageVersion.exists({ _id: value, page: pageId });
  return owned ? owned._id : null;
}

// Unpublish is the emergency takedown, so it must never be blocked by
// validation — a page that breaks today's rules (an old http:// image, a
// CTA label without a URL) still has to come down. Only `status` and
// `updatedBy` change; validation (and with it pre('validate')'s
// re-sanitising) is skipped, and save() writes just those modified paths.
async function unpublishPage(page, userId) {
  page.status = 'draft';
  page.updatedBy = userId;
  await page.save({ validateBeforeSave: false });
}

// ── Admin ────────────────────────────────────────────────────────────────

const getLandingPages = catchAsync(async (req, res) => {
  const { category, status, q, level } = req.query;
  const filter = {};
  if (level) {
    if (!LEVELS.includes(level)) return error(res, 'Invalid page type.', 400);
    filter.level = level;
  }
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
  const level = data.level === undefined ? 'city' : data.level;
  if (!LEVELS.includes(level)) return error(res, 'Choose a valid page type.', 400);
  if (level === 'category' && !data.category) return error(res, 'category is required.', 400);
  if (level === 'state' && (!data.category || !data.state)) return error(res, 'category and state are required.', 400);
  if (level === 'city' && (!data.category || !data.state || !data.city)) {
    return error(res, 'category, state and city are required.', 400);
  }
  if (!mongoose.isValidObjectId(data.category) || !(await ServiceCategory.exists({ _id: data.category }))) {
    return error(res, 'Category not found.', 400);
  }

  // Hubs start without a "Top vendors" block unless the admin asked for one.
  if (isHub(level)) {
    const vendorList = data.vendorList && typeof data.vendorList === 'object' ? data.vendorList : {};
    data.vendorList = { ...vendorList, enabled: vendorList.enabled === undefined ? false : vendorList.enabled };
  }

  const page = new LandingPage({ ...data, level, createdBy: req.user._id, updatedBy: req.user._id });
  const failed = await saveWithDuplicateCheck(res, page);
  if (failed) return failed;
  await recordSafely(page, { kind: 'create', adminId: req.user._id });

  return success(res, { page }, 'Landing page created.', 201);
});

const updateLandingPage = catchAsync(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return error(res, 'Landing page not found.', 404);
  const page = await LandingPage.findById(req.params.id);
  if (!page) return error(res, 'Landing page not found.', 404);

  const data = pickEditable(req.body); // never includes restoredFrom
  // The page type is fixed at creation; resending the same one is fine.
  if (data.level !== undefined && data.level !== levelOf(page)) {
    return error(res, "Page type can't be changed.", 400);
  }
  delete data.level;
  const previousStatus = page.status;
  // The editor's Unpublish sends exactly { status: 'draft' }.
  if (Object.keys(data).length === 1 && data.status === 'draft') {
    await unpublishPage(page, req.user._id);
    // Content is unchanged; the version records the takedown.
    if (previousStatus !== 'draft') await recordSafely(page, { kind: 'unpublish', adminId: req.user._id });
    return success(res, { page }, 'Landing page updated.');
  }
  const restoredFrom = await validRestoredFrom(req.body?.restoredFrom, page._id);
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

  // A status change names the version (and still snapshots any new
  // content); otherwise a restore, otherwise a plain save (skipped by the
  // service when nothing changed).
  let kind = restoredFrom ? 'restore' : 'save';
  if (page.status !== previousStatus) kind = page.status === 'published' ? 'publish' : 'unpublish';
  await recordSafely(page, { kind, adminId: req.user._id, restoredFrom });

  return success(res, { page }, 'Landing page updated.');
});

// Hard delete — the URL then falls back to the automatic page, which is
// the intended behavior.
const deleteLandingPage = catchAsync(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return error(res, 'Landing page not found.', 404);
  const page = await LandingPage.findByIdAndDelete(req.params.id);
  if (!page) return error(res, 'Landing page not found.', 404);
  await versionService.deleteVersionsFor(page._id);
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

// Mints a 30-minute token that shows this page — draft or published — at
// its real public URL. Read-only, so no audit log. The token is never
// logged; it's only returned to the admin who asked.
const createPreviewToken = catchAsync(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return error(res, 'Landing page not found.', 404);
  const page = await LandingPage.findById(req.params.id)
    .select('level category stateSlug citySlug')
    .populate('category', 'slug');
  if (!page) return error(res, 'Landing page not found.', 404);
  if (!page.category?.slug) return error(res, "This page's category no longer exists.", 409);

  const { token, expiresAt } = signPreviewToken(page._id);
  const path = `${publicPath(levelOf(page), page.category.slug, page.stateSlug, page.citySlug)}?preview=${encodeURIComponent(token)}`;
  return success(res, { token, expiresAt, path });
});

// `candidates` (same category + state) that are probably the same city as
// stateSlug/citySlug: same slug, a near-identical name, or the same Place
// via aliases ("Bangalore" vs "Bengaluru"). Shared by match-check and
// bulk create.
async function findSimilarPages(candidates, stateSlug, citySlug) {
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
  return similar;
}

// Hub match-check (Phase 4C): the vendors the page's scope counts, and
// existing pages of the same level — the same key ('same-slug', i.e. this
// page already exists) or, for state pages, a near-identical state name.
async function hubMatchCheck(res, level, serviceCategory, state, excludeId) {
  const stateSlug = level === 'state' ? slugify(String(state || '')) : '';
  if (level === 'state' && !stateSlug) return error(res, 'state must contain letters or digits.', 400);

  const scope = await scopeFilter(level, serviceCategory._id, stateSlug, '');
  const vendorCount = await Vendor.countDocuments(scope.filter);

  const candidates = await LandingPage.find({
    category: serviceCategory._id,
    level,
    ...(excludeId && mongoose.isValidObjectId(excludeId) ? { _id: { $ne: excludeId } } : {}),
  }).select('state city stateSlug citySlug status level');

  const similar = [];
  for (const c of candidates) {
    if (levelOf(c) !== level) continue;
    let reason = null;
    if (c.stateSlug === stateSlug) reason = 'same-slug';
    else if (level === 'state' && isSimilarSlug(c.stateSlug, stateSlug)) reason = 'similar-name';
    if (reason) {
      similar.push({
        _id: c._id, level, state: c.state, city: c.city, stateSlug: c.stateSlug, citySlug: c.citySlug, status: c.status, reason,
      });
    }
  }

  return success(res, {
    level,
    vendorCount,
    ...(level === 'state' && { matchedState: scope.matchedState || null }),
    similar,
  });
}

// Editor hint + duplicate warning. Never blocks — only informs.
// `category` is an ObjectId (or a slug); state/city are free text or slugs.
// `excludeId` leaves the page being edited out of `similar`. `level`
// (default 'city') picks the key: category pages ignore state and city,
// state pages ignore city. The city response is unchanged.
const matchCheck = catchAsync(async (req, res) => {
  const { category, state, city, excludeId } = req.query;
  const level = req.query.level || 'city';
  if (!LEVELS.includes(level)) return error(res, 'Invalid page type.', 400);
  if (!category) return error(res, 'category is required.', 400);
  if (level === 'state' && !state) return error(res, 'category and state are required.', 400);
  if (level === 'city' && (!state || !city)) return error(res, 'category, state and city are required.', 400);

  const serviceCategory = mongoose.isValidObjectId(category)
    ? await ServiceCategory.findById(category)
    : await ServiceCategory.findOne({ slug: category });
  if (!serviceCategory) return error(res, 'Category not found.', 404);

  if (isHub(level)) return hubMatchCheck(res, level, serviceCategory, state, excludeId);

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
    level: 'city',
    ...(excludeId && mongoose.isValidObjectId(excludeId) ? { _id: { $ne: excludeId } } : {}),
  }).select('state city stateSlug citySlug status level');

  const similar = await findSimilarPages(candidates, stateSlug, citySlug);

  return success(res, {
    matchedPlace: matchedPlace ? matchedPlace.name : null,
    vendorsByPlace,
    vendorsByName,
    similar,
  });
});

// ── Duplicate / bulk (Phase 4A) ──────────────────────────────────────────
// Every page these create is a DRAFT built through the model (so
// pre('validate') strips HTML, derives slugs and applies the CTA-pair and
// https rules); nothing goes live without the publish action.

const MAX_BULK_ITEMS = 50;
const MAX_BULK_ACTION_IDS = 100;
const BULK_ACTIONS = ['publish', 'unpublish', 'delete'];
const SIMILAR_CONCURRENCY = 5;

// A new draft for (state, city) carrying `template`'s content (including
// its level), or a blank city page when there's no template.
function buildDraft({ template, category, state, city, userId }) {
  return new LandingPage({
    ...(template ? copyContent(template) : {}),
    category,
    state,
    city,
    status: 'draft',
    createdBy: userId,
    updatedBy: userId,
  });
}

// fn over items, at most `limit` in flight; results in input order.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// One { state, city } -> { state, city, stateSlug, citySlug } or
// { ..., reason } when unusable. Slugs come from the HTML-stripped text,
// exactly as pre('validate') derives them.
function normaliseItem(raw) {
  const state = normaliseLocation(raw?.state);
  const city = normaliseLocation(raw?.city);
  const out = { state, city };
  if (!state) return { ...out, reason: 'State is required.' };
  if (!city) return { ...out, reason: 'City is required.' };
  if (state.length > MAX_LOCATION_LENGTH) return { ...out, reason: `State must be ${MAX_LOCATION_LENGTH} characters or fewer.` };
  if (city.length > MAX_LOCATION_LENGTH) return { ...out, reason: `City must be ${MAX_LOCATION_LENGTH} characters or fewer.` };
  const stateSlug = slugify(LandingPage.stripHtml(state));
  const citySlug = slugify(LandingPage.stripHtml(city));
  if (!stateSlug) return { ...out, reason: 'State must contain letters or digits.' };
  if (!citySlug) return { ...out, reason: 'City must contain letters or digits.' };
  return { ...out, stateSlug, citySlug };
}

// "Category — City, State" / "Category — State" / "Category".
function pageLabel(page, categoryName) {
  const name = categoryName || 'Unknown category';
  const level = levelOf(page);
  if (level === 'category') return name;
  if (level === 'state') return `${name} — ${page.state}`;
  return `${name} — ${page.city}, ${page.state}`;
}

// POST /admin/landing-pages/:id/duplicate -> 201 { page, warnings }. The
// body names the new location for the source's level: { state, city } for
// a city page, { state } for a state page (same category), { category }
// (another active category) for a category page.
const duplicateLandingPage = catchAsync(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return error(res, 'Landing page not found.', 404);
  const source = await LandingPage.findById(req.params.id);
  if (!source) return error(res, 'Landing page not found.', 404);
  const level = levelOf(source);

  let category = source.category;
  let state = '';
  let city = '';
  if (level === 'category') {
    const target = req.body?.category;
    if (!target) return error(res, 'category is required.', 400);
    if (!mongoose.isValidObjectId(target) || !(await ServiceCategory.exists({ _id: target, isActive: true }))) {
      return error(res, 'Category not found.', 400);
    }
    category = target;
  } else {
    state = normaliseLocation(req.body?.state);
    city = normaliseLocation(req.body?.city);
    if (level === 'state' && !state) return error(res, 'state is required.', 400);
    if (level === 'city' && (!state || !city)) return error(res, 'state and city are required.', 400);
  }

  const page = buildDraft({ template: source, category, state, city, userId: req.user._id });
  const failed = await saveWithDuplicateCheck(res, page);
  if (failed) return failed;
  await recordSafely(page, { kind: 'duplicate', adminId: req.user._id });

  const sameCategory = String(category) === String(source.category);
  const [sourceCategory, targetCategory] = await Promise.all([
    ServiceCategory.findById(source.category).select('name'),
    sameCategory ? null : ServiceCategory.findById(category).select('name'),
  ]);
  const sourceName = sourceCategory?.name;
  const targetName = sameCategory ? sourceName : targetCategory?.name;
  const warnings = findSourceMentions(source, {
    state, city, ...(level === 'category' && { category: targetName, sourceCategory: sourceName }),
  });
  // Audit: ids and "Category — City, State" labels only, never content.
  // Set only on success; a 4xx isn't audited at all.
  const label = (p, name) => pageLabel(p, name);
  res.locals.auditDetails = {
    sourceId: String(source._id),
    sourceLabel: label(source, sourceName),
    newId: String(page._id),
    newLabel: label(page, targetName),
    warnings: warnings.length,
  };

  return success(res, { page, warnings }, 'Draft created.', 201);
});

// POST /admin/landing-pages/bulk { templateId?, category?, items, dryRun? }
// Per item: ok | invalid | exists | duplicate_in_batch | similar. dryRun
// adds vendorCount and writes nothing (and isn't audited). A real run
// creates drafts for ok + similar items, keeps going past per-item
// failures, and is audited once with the counts.
const bulkCreateLandingPages = catchAsync(async (req, res) => {
  const { templateId, category: categoryParam, items, dryRun } = req.body || {};
  const isDryRun = dryRun === true;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_BULK_ITEMS) {
    return error(res, `Send between 1 and ${MAX_BULK_ITEMS} locations.`, 400);
  }
  if (!templateId && !categoryParam) return error(res, 'Choose a category or a template.', 400);

  let template = null;
  if (templateId) {
    if (!mongoose.isValidObjectId(templateId)) return error(res, 'Template not found.', 404);
    template = await LandingPage.findById(templateId);
    if (!template) return error(res, 'Template not found.', 404);
    // Bulk create makes city pages only.
    if (levelOf(template) !== 'city') return error(res, 'Templates must be city pages.', 400);
  }
  if (categoryParam && (!mongoose.isValidObjectId(categoryParam) || !(await ServiceCategory.exists({ _id: categoryParam })))) {
    return error(res, 'Category not found.', 400);
  }
  const category = categoryParam || String(template.category);
  const warnings = [];
  if (template && categoryParam && String(template.category) !== String(categoryParam)) {
    warnings.push('The template is from a different category.');
  }

  // Classify: invalid, then duplicate_in_batch, then exists / similar.
  const results = items.map((raw, index) => {
    const item = normaliseItem(raw);
    return item.reason
      ? { index, state: item.state, city: item.city, status: 'invalid', reason: item.reason }
      : { index, ...item, status: 'ok' };
  });
  const seen = new Map();
  for (const r of results) {
    if (r.status !== 'ok') continue;
    const key = `${r.stateSlug}/${r.citySlug}`;
    if (seen.has(key)) {
      r.status = 'duplicate_in_batch';
      r.duplicateOf = seen.get(key);
    } else {
      seen.set(key, r.index);
    }
  }

  const live = results.filter((r) => r.status === 'ok');
  const stateSlugs = [...new Set(live.map((r) => r.stateSlug))];
  const existing = stateSlugs.length
    ? await LandingPage.find({ category, level: 'city', stateSlug: { $in: stateSlugs } }).select('state city stateSlug citySlug status level')
    : [];
  await mapLimit(live, SIMILAR_CONCURRENCY, async (r) => {
    const inState = existing.filter((p) => p.stateSlug === r.stateSlug);
    const same = inState.find((p) => p.citySlug === r.citySlug);
    if (same) {
      r.status = 'exists';
      r.existingId = same._id;
      return;
    }
    const similar = (await findSimilarPages(inState, r.stateSlug, r.citySlug)).find((p) => p.reason !== 'same-slug');
    if (similar) {
      r.status = 'similar';
      r.similarTo = { _id: similar._id, city: similar.city, state: similar.state, reason: similar.reason };
    }
  });

  if (isDryRun) {
    res.locals.skipAudit = true;
    await mapLimit(results, SIMILAR_CONCURRENCY, async (r) => {
      if (r.status === 'invalid') return;
      const { filter } = await buildVendorFilter(category, r.stateSlug, r.citySlug);
      r.vendorCount = await Vendor.countDocuments(filter);
    });
    const summary = { total: results.length };
    for (const r of results) summary[r.status] = (summary[r.status] || 0) + 1;
    return success(res, { results, summary, warnings });
  }

  // Sequential writes: ≤50 items, and each save is validated on its own.
  for (const r of results) {
    if (r.status !== 'ok' && r.status !== 'similar') continue;
    const page = buildDraft({ template, category, state: r.state, city: r.city, userId: req.user._id });
    try {
      await page.validate();
      await page.save();
      await recordSafely(page, { kind: 'bulk_create', adminId: req.user._id });
      r.status = 'created';
      r.pageId = page._id;
      r.warnings = template ? findSourceMentions(template, r) : [];
    } catch (err) {
      if (err.code === 11000) {
        r.status = 'exists';
      } else if (err.name === 'ValidationError') {
        r.status = 'failed';
        r.reason = Object.values(validationErrors(err)).join(', ');
      } else {
        r.status = 'failed';
        r.reason = 'Something went wrong creating this page.';
      }
    }
  }

  const created = results.filter((r) => r.status === 'created').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const summary = { created, failed, skipped: results.length - created - failed };
  res.locals.auditDetails = { ...summary, templateId: template ? String(template._id) : null, category: String(category) };
  return success(res, { results, summary, warnings });
});

// POST /admin/landing-pages/bulk-action { ids, action } -> per-id
// ok | unchanged | failed | not_found. Publish loads and validates each
// page; one that fails is left unchanged. Unpublish never validates (see
// unpublishPage).
const bulkLandingPageAction = catchAsync(async (req, res) => {
  const { ids, action } = req.body || {};
  if (!BULK_ACTIONS.includes(action)) return error(res, `action must be one of: ${BULK_ACTIONS.join(', ')}.`, 400);
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_BULK_ACTION_IDS) {
    return error(res, `Select between 1 and ${MAX_BULK_ACTION_IDS} pages.`, 400);
  }

  const unique = [...new Set(ids.map(String))];
  const validIds = unique.filter((id) => mongoose.isValidObjectId(id));
  const docs = validIds.length ? await LandingPage.find({ _id: { $in: validIds } }) : [];
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const results = [];
  for (const id of unique) {
    const page = byId.get(id);
    if (!page) {
      results.push({ id, status: 'not_found' });
      continue;
    }
    try {
      if (action === 'delete') {
        await LandingPage.deleteOne({ _id: page._id });
        await versionService.deleteVersionsFor(page._id);
        results.push({ id, status: 'ok' });
        continue;
      }
      const target = action === 'publish' ? 'published' : 'draft';
      if (page.status === target) {
        results.push({ id, status: 'unchanged' });
        continue;
      }
      if (action === 'unpublish') {
        await unpublishPage(page, req.user._id);
      } else {
        page.status = target;
        page.updatedBy = req.user._id;
        await page.validate(); // pre('validate') also sets publishedAt on first publish
        await page.save();
      }
      await recordSafely(page, { kind: action, adminId: req.user._id });
      results.push({ id, status: 'ok' });
    } catch (err) {
      const message = err.name === 'ValidationError'
        ? Object.values(validationErrors(err)).join(', ')
        : 'Something went wrong.';
      results.push({ id, status: 'failed', message });
    }
  }

  const summary = { ok: 0, unchanged: 0, failed: 0, not_found: 0 };
  for (const r of results) summary[r.status] += 1;
  res.locals.auditDetails = { action, ...summary, ids: unique.slice(0, MAX_BULK_ACTION_IDS) };
  return success(res, { results, summary });
});

// ── Version history (Phase 4B, read-only) ────────────────────────────────

const versionSummary = (v) => ({
  id: v._id,
  kind: v.kind,
  createdAt: v.createdAt,
  savedBy: v.savedBy && typeof v.savedBy === 'object' && v.savedBy.name ? { name: v.savedBy.name } : null,
  changedFields: v.changedFields || [],
  restoredFrom: v.restoredFrom || null,
});

// GET /admin/landing-pages/:id/versions — newest first, no snapshots.
const getLandingPageVersions = catchAsync(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return error(res, 'Landing page not found.', 404);
  if (!(await LandingPage.exists({ _id: req.params.id }))) return error(res, 'Landing page not found.', 404);
  const versions = await LandingPageVersion.find({ page: req.params.id })
    .sort({ createdAt: -1, _id: -1 })
    .select('-snapshot')
    .populate('savedBy', 'name');
  return success(res, { versions: versions.map(versionSummary) });
});

// GET /admin/landing-pages/:id/versions/:versionId — one version with its
// snapshot; 404 unless it belongs to that page.
const getLandingPageVersion = catchAsync(async (req, res) => {
  const { id, versionId } = req.params;
  if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(versionId)) return error(res, 'Version not found.', 404);
  const version = await LandingPageVersion.findOne({ _id: versionId, page: id }).populate('savedBy', 'name');
  if (!version) return error(res, 'Version not found.', 404);
  return success(res, { version: { ...versionSummary(version), snapshot: version.snapshot } });
});

// ── Public ───────────────────────────────────────────────────────────────

const PUBLIC_OMIT = '-createdBy -updatedBy -__v';

// Lookup is by (category, stateSlug, citySlug) ONLY — never through
// Place — so a published page for a free-text city still resolves.
// Returns page:null for no record or a draft; vendors/indexable are
// computed either way, using the default vendorList/seo settings when
// there's no page.
//
// `preview` (optional): a token from createPreviewToken. Only when it
// verifies AND names the page at this exact URL is the published filter
// dropped; the response then adds `preview: true`, forces
// `indexable: false` and is no-store. Any other token — missing, expired,
// tampered, another purpose, another page — gets exactly the normal
// response, so it never reveals whether a draft exists.
//
// Phase 4C: the level comes from the params — category only = category
// hub, + state = state hub, + city = city page (city without state is a
// 400). The city response is unchanged; hubs answer
// { page, vendors, vendorCount, indexable, level }, where vendors stays []
// unless the page turned its "Top vendors" block on (vendorCount is always
// there, for {{vendorCount}}).
const getPublicLandingPage = catchAsync(async (req, res) => {
  const { category, state, city, preview } = req.query;
  if (!category) return error(res, 'category is required.', 400);
  if (city && !state) return error(res, 'state is required when city is set.', 400);
  if (!city) return getPublicHubPage(req, res, state ? 'state' : 'category');

  const serviceCategory = await resolveCategory(category);
  if (!serviceCategory) return error(res, 'Category not found.', 404);

  const stateSlug = slugify(String(state));
  const citySlug = slugify(String(city));
  if (!stateSlug || !citySlug) return error(res, 'Invalid state or city.', 400);

  const key = { category: serviceCategory._id, stateSlug, citySlug, level: 'city' };
  const findPage = (filter) => LandingPage.findOne(filter)
    .select(PUBLIC_OMIT)
    .populate('category', 'name slug schemaOrgType');

  const previewPageId = verifyPreviewToken(preview);
  let page = null;
  let isPreview = false;
  if (previewPageId && mongoose.isValidObjectId(previewPageId)) {
    page = await findPage({ ...key, _id: previewPageId });
    isPreview = Boolean(page);
  }
  if (!isPreview) page = await findPage({ ...key, status: 'published' });

  const sort = page?.vendorList?.sort || 'featured';
  const limit = page?.vendorList?.limit || 12;
  const indexing = page?.seo?.indexing || 'auto';

  const { filter } = await buildVendorFilter(serviceCategory._id, stateSlug, citySlug);
  const vendorCount = await Vendor.countDocuments(filter);
  const vendors = await Vendor.find(filter)
    .sort(VENDOR_SORT[sort] || VENDOR_SORT.featured)
    .limit(limit)
    .populate('userId', 'name');

  const body = {
    page: page || null,
    vendors: await attachCardImages(vendors),
    vendorCount,
    indexable: isPreview ? false : computeIndexable('city', indexing, vendorCount),
  };
  if (isPreview) {
    body.preview = true;
    res.set('Cache-Control', 'no-store');
  }
  return success(res, body);
});

// The category/state half of getPublicLandingPage — same lookup and
// preview rules, keyed with '' for the missing location parts.
async function getPublicHubPage(req, res, level) {
  const { category, state, preview } = req.query;
  const serviceCategory = await resolveCategory(category);
  if (!serviceCategory) return error(res, 'Category not found.', 404);

  const stateSlug = level === 'state' ? slugify(String(state)) : '';
  if (level === 'state' && !stateSlug) return error(res, 'Invalid state.', 400);

  const key = { category: serviceCategory._id, stateSlug, citySlug: '', level };
  const findPage = (filter) => LandingPage.findOne(filter)
    .select(PUBLIC_OMIT)
    .populate('category', 'name slug schemaOrgType');

  const previewPageId = verifyPreviewToken(preview);
  let page = null;
  let isPreview = false;
  if (previewPageId && mongoose.isValidObjectId(previewPageId)) {
    page = await findPage({ ...key, _id: previewPageId });
    isPreview = Boolean(page);
  }
  if (!isPreview) page = await findPage({ ...key, status: 'published' });

  const { filter } = await scopeFilter(level, serviceCategory._id, stateSlug, '');
  const vendorCount = await Vendor.countDocuments(filter);
  let vendors = [];
  if (page?.vendorList?.enabled === true) {
    const found = await Vendor.find(filter)
      .sort(VENDOR_SORT[page.vendorList.sort] || VENDOR_SORT.featured)
      .limit(page.vendorList.limit || 12)
      .populate('userId', 'name');
    vendors = await attachCardImages(found);
  }

  const body = {
    page: page || null,
    vendors,
    vendorCount,
    indexable: isPreview ? false : computeIndexable(level, page?.seo?.indexing || 'auto', vendorCount),
    level,
  };
  if (isPreview) {
    body.preview = true;
    res.set('Cache-Control', 'no-store');
  }
  return success(res, body);
}

// Published pages for the sitemap, every level (Phase 4C adds `level`;
// hubs have '' for their missing slugs). Pages whose category is gone or
// inactive are skipped — their URLs 404 anyway. Only city pages need a
// vendor count: hubs are indexable unless set to noindex.
const getLandingPagesSitemap = catchAsync(async (req, res) => {
  const pages = await LandingPage.find({ status: 'published' })
    .select('level category stateSlug citySlug updatedAt seo.indexing')
    .populate('category', 'slug isActive')
    .sort({ updatedAt: -1 });

  const entries = [];
  for (const p of pages) {
    if (!p.category || !p.category.isActive) continue;
    const level = levelOf(p);
    const indexing = p.seo?.indexing || 'auto';
    let vendorCount = 0;
    if (level === 'city') {
      const { filter } = await buildVendorFilter(p.category._id, p.stateSlug, p.citySlug);
      vendorCount = await Vendor.countDocuments(filter);
    }
    entries.push({
      level,
      categorySlug: p.category.slug,
      stateSlug: p.stateSlug || '',
      citySlug: p.citySlug || '',
      updatedAt: p.updatedAt,
      indexable: computeIndexable(level, indexing, vendorCount),
    });
  }

  return success(res, { pages: entries });
});

module.exports = {
  getLandingPages, getLandingPageById, createLandingPage, updateLandingPage, deleteLandingPage, matchCheck,
  getLandingPageCategories, uploadLandingPageImage, createPreviewToken,
  duplicateLandingPage, bulkCreateLandingPages, bulkLandingPageAction,
  getLandingPageVersions, getLandingPageVersion,
  getPublicLandingPage, getLandingPagesSitemap,
};
