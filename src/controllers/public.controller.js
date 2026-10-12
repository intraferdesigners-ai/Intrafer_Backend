const Vendor = require('../models/Vendor.model');
const Project = require('../models/Project.model');
const Lead = require('../models/Lead.model');
const Settings = require('../models/Settings.model');
const Review = require('../models/Review.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const paginate = require('../utils/paginate');
const { resolveCategory, resolveState, resolvePlaceInState } = require('../utils/resolveTaxonomy');
const { meetsIndexThreshold } = require('../utils/indexThreshold');
const { queryString, containsRegex } = require('../utils/regex');
const { isObjectId } = require('../utils/objectId');
const { VISIBLE_VENDOR, PUBLIC_PROJECT, publicProjectFilter, visibleVendorPopulate } = require('../utils/publicVisibility');

const SORT_MAP = {
  rating:  { rating: -1 },
  reviews: { reviewCount: -1 },
  newest:  { createdAt: -1 },
  name:    { businessName: 1 },
};

// Caps how many project photos a single VendorCard pools for its
// auto-sliding background — bounded so a prolific vendor's slideshow
// doesn't run forever, not because any one project shouldn't contribute
// more than one photo.
const MAX_CARD_IMAGES = 6;

// Vendor.portfolioImages exists on the schema but nothing ever writes to
// it — a vendor's real photos live on their Project documents. Pools up to
// MAX_CARD_IMAGES photos per vendor from their published/approved projects
// and attaches them as `cardImages`, so VendorCard's editorial variant has
// something real to auto-slide through instead of falling straight to the
// placeholder icon.
//
// Round-robins one photo per project per pass (most recently created
// project first) rather than taking every photo from project #1 before
// touching project #2 — most vendors here only have one or two published
// projects, so pulling just images[0] from each would almost always cap
// out at one pooled photo per vendor (nothing to slide through) even
// though that single project has several photos. Round-robin keeps a
// vendor with one 5-photo project sliding through several of them, while a
// vendor with many projects still gets a photo from more of them before
// its cap is reached.
//
// A brand-new vendor has zero published projects (moderation takes time,
// or they just haven't added one yet) but may already have a bannerImage
// from onboarding — falling straight to the placeholder icon in that case
// throws away a real photo the vendor already uploaded. So when no project
// images are pooled, fall back to bannerImage alone before giving up to the
// placeholder — not profilePhoto too: that's a personal headshot, not a
// project/cover photo, and mixing it in here made a vendor's own face show
// up as their card's sole image, which reads wrong on the public listing.
async function attachCardImages(vendors) {
  const ids = vendors.map((v) => v._id);
  if (ids.length === 0) return vendors;

  const projects = await Project.find({
    vendorId: { $in: ids },
    isPublished: true,
    moderationStatus: 'approved',
    images: { $exists: true, $ne: [] },
  })
    .select('vendorId images')
    .sort({ createdAt: -1 });

  const projectsByVendor = new Map();
  for (const p of projects) {
    const key = p.vendorId.toString();
    const list = projectsByVendor.get(key) || [];
    list.push(p.images);
    projectsByVendor.set(key, list);
  }

  const byVendor = new Map();
  for (const [key, imageLists] of projectsByVendor) {
    const pooled = [];
    for (let round = 0; pooled.length < MAX_CARD_IMAGES; round++) {
      const before = pooled.length;
      for (const images of imageLists) {
        if (images[round] !== undefined) pooled.push(images[round]);
        if (pooled.length >= MAX_CARD_IMAGES) break;
      }
      if (pooled.length === before) break; // every project's images exhausted
    }
    byVendor.set(key, pooled);
  }

  return vendors.map((v) => {
    const obj = v.toObject ? v.toObject() : v;
    const pooled = byVendor.get(v._id.toString()) || [];
    obj.cardImages = pooled.length > 0
      ? pooled
      : (obj.bannerImage ? [obj.bannerImage] : []);
    return obj;
  });
}

const getVendors = catchAsync(async (req, res) => {
  // Strings only, capped — arrays/objects from the query string are dropped.
  const [city, locality, specialization, sort, category, state] =
    ['city', 'locality', 'specialization', 'sort', 'category', 'state'].map((k) => queryString(req.query[k]));
  const { featured } = req.query;

  const filter = { isApproved: true, isListingEnabled: true };
  // Set only in the category+state+city branch below — the real-cased
  // Place/state names the /[category]/[state]/[city]/ page needs for its
  // title/h1/breadcrumb, same reasoning as getCategoryCities' `state`
  // field. Stays undefined (omitted from the response) on every existing
  // call pattern, so that response shape is untouched.
  let resolvedLocation;

  // SEO taxonomy filtering (step 5 of the SEO restructuring project) —
  // only kicks in when category+state+city are ALL present together (the
  // /[category]/[state]/[city]/ page always sends all three), so it can
  // never shadow the plain free-text `city`/`locality`/`specialization`
  // filtering below, which every existing caller keeps using untouched.
  // category/state/city here are slugs (same slugify() logic the frontend
  // used to build the link), resolved via the shared taxonomy resolver so
  // this stays in lockstep with getCategoryCities. An invalid category or a
  // state/city slug matching no real Place 404s — those are malformed
  // URLs, not "zero vendors here yet".
  if (category && state && city) {
    const serviceCategory = await resolveCategory(category);
    if (!serviceCategory) return error(res, 'Category not found.', 404);

    const matchedState = await resolveState(state);
    if (!matchedState) return error(res, 'State not found.', 404);

    const matchedPlace = await resolvePlaceInState(city, matchedState);
    if (!matchedPlace) return error(res, 'City not found.', 404);

    filter.primaryCategory = serviceCategory._id;
    filter.$or = [
      { 'location.placeId': matchedPlace._id },
      { 'serviceLocations.placeId': matchedPlace._id },
    ];
    resolvedLocation = { state: matchedState, city: matchedPlace.name };
  } else {
    // A city match must check BOTH a vendor's free-text business-address city
    // (location.city) AND every city in their serviceLocations array — a
    // vendor whose home base is Bengaluru but who also services Mysuru should
    // still turn up when someone filters by Mysuru. This used to only ever
    // check location.city, silently missing every serviceLocations-only match.
    // `locality` (no dedicated field on Vendor yet) is folded into the same
    // OR as an extra term, in case a vendor happened to enter a neighborhood
    // name into one of these city fields.
    if (city || locality) {
      const terms = [city, locality].filter(Boolean).map(containsRegex);
      filter.$or = [
        { 'location.city': { $in: terms } },
        { 'serviceLocations.city': { $in: terms } },
      ];
    }
    if (specialization) filter.specializations = { $in: [containsRegex(specialization)] };
  }

  if (featured === 'true') filter.isFeatured = true;

  const baseSort = SORT_MAP[sort] || SORT_MAP.rating;
  const sortObj = { isFeatured: -1, ...baseSort };

  const total = await Vendor.countDocuments(filter);
  const { skip, limit, page, totalPages } = paginate(req.query, total);

  const vendors = await Vendor.find(filter)
    .sort(sortObj)
    .skip(skip)
    .limit(limit)
    .populate('userId', 'name');

  const payload = { vendors: await attachCardImages(vendors), total, page, totalPages };
  // meetsThreshold: only computed/attached in the category+state+city
  // branch (same gate as resolvedLocation) — the SEO restructuring
  // project's step 12 indexation decision for the /[category]/[state]/
  // [city]/ page. `total` here is Vendor.countDocuments(filter), the real
  // count for this exact category+state+city combo, unaffected by
  // pagination — not the (possibly page-limited) `vendors.length`. Keeps
  // the threshold logic itself in one place (indexThreshold.js) rather
  // than duplicating MIN_VENDORS_TO_INDEX on the frontend.
  if (resolvedLocation) Object.assign(payload, resolvedLocation, { meetsThreshold: meetsIndexThreshold(total) });
  return success(res, payload);
});

const getVendorById = catchAsync(async (req, res) => {
  // A malformed id is as missing as an unknown one (not a cast error, 500).
  if (!isObjectId(req.params.id)) return error(res, 'Vendor not found.', 404);
  const vendor = await Vendor.findOne({
    _id: req.params.id,
    isApproved: true,
    isListingEnabled: true,
  })
    .populate('userId', 'name phone email')
    // SEO restructuring, step 6: the vendor profile page's breadcrumb
    // (Home > Category > State > City > Vendor) needs the real category
    // slug/name and the real place name/state, not just the raw ObjectIds
    // — same populated shape the [category]/[state]/[city] pages already
    // work with. Either can be null/unset (primaryCategory on any vendor
    // signed up before step 1's backfill window closes for new signups;
    // location.placeId when a vendor's free-text city never resolved
    // during step 2's backfill), which the page handles by omitting the
    // breadcrumb rather than rendering broken links.
    .populate('primaryCategory', 'name slug schemaOrgType')
    .populate('location.placeId', 'name state');

  if (!vendor) return error(res, 'Vendor not found.', 404);
  return success(res, { vendor });
});

// Same limit as the frontend's compare tray (context/CompareContext.jsx).
const MAX_COMPARE_IDS = 4;

// ?ids=<id>,<id>,... — at most MAX_COMPARE_IDS vendor ObjectIds. Missing or
// empty -> []. Anything malformed is a 400 rather than a cast error (500):
// a repeated ?ids= (an array), bracket forms (?ids[]=a, ?ids[$ne]=x — with
// Express 5's simple query parser these arrive as keys named "ids[...]"),
// too many ids, or an id that isn't a 24-hex ObjectId. Valid but
// unknown/hidden ids just aren't listed.
const getVendorsByIds = catchAsync(async (req, res) => {
  const { ids } = req.query;
  const bracketForm = Object.keys(req.query).some((key) => key.startsWith('ids['));
  if (bracketForm || (ids !== undefined && typeof ids !== 'string')) {
    return error(res, 'ids must be a comma-separated list of vendor ids.', 400);
  }
  if (ids === undefined || ids === '') return success(res, { vendors: [] });

  const idList = [...new Set(ids.split(',').map((id) => id.trim()).filter(Boolean))];
  if (idList.length === 0) return success(res, { vendors: [] });
  if (idList.length > MAX_COMPARE_IDS) return error(res, `Compare at most ${MAX_COMPARE_IDS} vendors at a time.`, 400);
  if (!idList.every(isObjectId)) return error(res, 'Invalid vendor id.', 400);

  const vendors = await Vendor.find({
    _id: { $in: idList },
    isApproved: true,
    isListingEnabled: true,
  }).populate('userId', 'name');

  return success(res, { vendors });
});

const getVendorProjects = catchAsync(async (req, res) => {
  // A hidden vendor's projects — or a malformed id's — are the same empty
  // list a nonexistent vendor gets.
  if (!isObjectId(req.params.id) || !(await Vendor.exists({ _id: req.params.id, ...VISIBLE_VENDOR }))) {
    return success(res, { projects: [] });
  }
  const projects = await Project.find({
    vendorId: req.params.id,
    ...PUBLIC_PROJECT,
  }).sort({ createdAt: -1 });

  return success(res, { projects });
});

const getProjectById = catchAsync(async (req, res) => {
  if (!isObjectId(req.params.id)) return error(res, 'Project not found.', 404);
  const project = await Project.findOne({
    _id: req.params.id,
    ...PUBLIC_PROJECT,
  }).populate(visibleVendorPopulate('businessName location rating reviewCount profilePhoto isApproved'));

  // vendorId populates to null when the vendor is hidden or deleted — the
  // project is then exactly as missing as an unpublished one.
  if (!project || !project.vendorId) return error(res, 'Project not found.', 404);
  return success(res, { project });
});

const getSimilarVendors = catchAsync(async (req, res) => {
  if (!isObjectId(req.params.id)) return error(res, 'Vendor not found.', 404);
  const current = await Vendor.findById(req.params.id);
  if (!current) return error(res, 'Vendor not found.', 404);

  const vendors = await Vendor.find({
    _id: { $ne: current._id },
    isApproved: true,
    isListingEnabled: true,
    $or: [
      { specializations: { $in: current.specializations } },
      { 'location.city': current.location?.city },
    ],
  })
    .sort({ rating: -1 })
    .limit(3)
    .populate('userId', 'name');

  return success(res, { vendors: await attachCardImages(vendors) });
});

const getGallery = catchAsync(async (req, res) => {
  const { page, limit } = req.query;
  const room = containsRegex(req.query.room);
  const style = containsRegex(req.query.style);

  const filter = await publicProjectFilter();
  if (room) filter.projectType = { $regex: room };
  if (style) filter.style = { $regex: style };

  // Optional pagination — added so every approved project can eventually
  // be enumerated (e.g. for sitemap inclusion, not wired up yet), the same
  // way GET /api/public/vendors already can. Only activates when page or
  // limit is explicitly passed; the live /gallery page calls this with
  // neither and must keep getting the exact same response shape (implicit
  // top-50 by completedYear, no total/totalPages) it always has.
  if (page === undefined && limit === undefined) {
    const projects = await Project.find(filter)
      .sort({ completedYear: -1 })
      .limit(50)
      .populate('vendorId', 'businessName location _id');

    return success(res, { projects });
  }

  const total = await Project.countDocuments(filter);
  const paginated = paginate(req.query, total);

  // completedYear alone isn't a stable sort key for skip/limit paging —
  // several real projects share the same year (e.g. 5 are all 2026), and
  // Mongo doesn't guarantee a consistent relative order among tied
  // documents across separate queries, so consecutive pages could return
  // duplicates or skip some entirely. _id as a secondary key makes the
  // sort deterministic; verified by paginating through every real project
  // and confirming zero duplicates/gaps. Only added here, not on the
  // no-params branch above, so that branch's response stays byte-for-byte
  // identical to before this change (verified).
  const projects = await Project.find(filter)
    .sort({ completedYear: -1, _id: 1 })
    .skip(paginated.skip)
    .limit(paginated.limit)
    .populate('vendorId', 'businessName location _id');

  return success(res, { projects, total, page: paginated.page, totalPages: paginated.totalPages });
});

const getStats = catchAsync(async (req, res) => {
  const [vendorCount, projectCount, enquiryCount, ratingAgg, featuredCount] = await Promise.all([
    Vendor.countDocuments({ isApproved: true, isListingEnabled: true }),
    publicProjectFilter().then((filter) => Project.countDocuments(filter)),
    Lead.countDocuments(),
    // Stored reviews themselves (same source as getSiteReviews), not an
    // average of Vendor.rating — that averaged unrated vendors in as 0s.
    Review.aggregate([
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]),
    Vendor.countDocuments({ isFeatured: true, isApproved: true }),
  ]);

  // null, never a made-up figure, when there are no reviews yet — callers
  // hide the rating instead. reviewCount lets them judge how much it's worth.
  const reviewCount = ratingAgg[0]?.count ?? 0;
  const avgRating = reviewCount > 0 ? Number(ratingAgg[0].avg).toFixed(1) : null;

  return success(res, { vendorCount, projectCount, enquiryCount, avgRating, reviewCount, featuredCount });
});

const getFeaturedProjects = catchAsync(async (req, res) => {
  const visible = await publicProjectFilter();
  const featured = await Project.find({ ...visible, isFeatured: true })
    .populate('vendorId', 'businessName')
    .sort({ createdAt: -1 })
    .limit(8);

  let projects = featured;
  if (projects.length < 4) {
    const excludeIds = projects.map((p) => p._id);
    const fillers = await Project.find({
      ...visible,
      _id: { $nin: excludeIds },
    })
      .populate('vendorId', 'businessName')
      .sort({ createdAt: -1 })
      .limit(8 - projects.length);
    projects = [...projects, ...fillers];
  }

  return success(res, { projects });
});

const getRelatedProjects = catchAsync(async (req, res) => {
  // Related projects of a hidden project 404 like the project itself does.
  if (!isObjectId(req.params.id)) return error(res, 'Project not found.', 404);
  const visible = await publicProjectFilter();
  const current = await Project.findOne({ ...visible, _id: req.params.id });
  if (!current) return error(res, 'Project not found.', 404);

  const sameType = await Project.find({
    ...visible,
    _id: { $ne: current._id },
    projectType: current.projectType,
  })
    .populate('vendorId', 'businessName')
    .sort({ createdAt: -1 })
    .limit(4);

  let projects = sameType;
  if (projects.length < 4) {
    const excludeIds = [current._id, ...projects.map((p) => p._id)];
    const fillers = await Project.find({
      ...visible,
      _id: { $nin: excludeIds },
    })
      .populate('vendorId', 'businessName')
      .sort({ createdAt: -1 })
      .limit(4 - projects.length);
    projects = [...projects, ...fillers];
  }

  return success(res, { projects });
});

// Kept in sync with SETTINGS_DEFAULTS.homepage_hero_subtitle in
// admin.controller.js — this is the copy that ships until an admin saves
// their own via the CMS page, so the homepage never renders blank.
const DEFAULT_HERO_SUBTITLE = "Compare vetted interior designers by city, style, and budget. Every portfolio shown is real, completed work — submit one enquiry and hear back within two days.";

const getHomepageContent = catchAsync(async (req, res) => {
  const doc = await Settings.findOne({ key: 'homepage_hero_subtitle' });
  return success(res, { heroSubtitle: doc?.value ?? DEFAULT_HERO_SUBTITLE });
});

const REVIEW_POPULATE = [
  { path: 'userId', select: 'name' },
  { path: 'vendorId', select: 'businessName location.city specializations' },
  { path: 'leadId', select: 'projectType city contactName' },
];

// "Rahul Sharma" -> "Rahul S." — first name plus last-initial only, never the
// full surname, so the public testimonials page doesn't expose a homeowner's
// full name.
const shapeReviewerName = (fullName) => {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Homeowner';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
};

const shapeReview = (r) => ({
  id: r._id,
  rating: r.rating,
  comment: r.comment,
  // leadId.contactName is the source for reviews submitted via the
  // token-based flow (no User at all — see review.controller.js); userId
  // stays the fallback for reviews from before that change. See the
  // homeowner-removal plan, Phase 0/7.
  userName: shapeReviewerName(r.leadId?.contactName || r.userId?.name),
  vendorName: r.vendorId?.businessName || '',
  vendorCity: r.leadId?.city || r.vendorId?.location?.city || '',
  projectType: r.leadId?.projectType || r.vendorId?.specializations?.[0] || 'Interior Design',
  createdAt: r.createdAt,
});

const getSiteReviews = catchAsync(async (req, res) => {
  const statsAgg = await Review.aggregate([
    { $group: { _id: null, avgRating: { $avg: '$rating' }, totalCount: { $sum: 1 } } },
  ]);
  const avgRating = statsAgg[0]?.avgRating ? Math.round(statsAgg[0].avgRating * 10) / 10 : 0;
  const totalCount = statsAgg[0]?.totalCount ?? 0;

  const withComments = await Review.find({ comment: { $ne: '' } })
    .sort({ createdAt: -1 })
    .limit(24)
    .populate(REVIEW_POPULATE);

  let sample = withComments;
  if (sample.length < 6) {
    const excludeIds = sample.map((r) => r._id);
    const fillers = await Review.find({ _id: { $nin: excludeIds } })
      .sort({ createdAt: -1 })
      .limit(6 - sample.length)
      .populate(REVIEW_POPULATE);
    sample = [...sample, ...fillers];
  }

  return success(res, { reviews: sample.map(shapeReview), stats: { avgRating, totalCount } });
});

const STYLE_LABELS = ['Modern', 'Scandinavian', 'Traditional', 'Minimalist', 'Bohemian', 'Industrial', 'Luxury', 'Contemporary'];

const getStyleCounts = catchAsync(async (req, res) => {
  const counts = {};
  await Promise.all(STYLE_LABELS.map(async (label) => {
    const count = await Vendor.countDocuments({
      isApproved: true,
      isListingEnabled: true,
      specializations: { $in: [new RegExp(`^${label}$`, 'i')] },
    });
    counts[label.toLowerCase()] = count;
  }));

  return success(res, { counts });
});

module.exports = { getVendors, getVendorById, getVendorsByIds, getVendorProjects, getProjectById, getSimilarVendors, getGallery, getStats, getFeaturedProjects, getRelatedProjects, getHomepageContent, getSiteReviews, getStyleCounts, attachCardImages };
