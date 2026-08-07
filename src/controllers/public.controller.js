const Vendor = require('../models/Vendor.model');
const Project = require('../models/Project.model');
const Lead = require('../models/Lead.model');
const Settings = require('../models/Settings.model');
const Review = require('../models/Review.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const paginate = require('../utils/paginate');

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
// or profilePhoto from onboarding — falling straight to the placeholder
// icon in that case throws away a real photo the vendor already uploaded.
// So when no project images are pooled, fall back to bannerImage, then
// profilePhoto, before giving up to the placeholder.
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
      : [obj.bannerImage, obj.profilePhoto].filter(Boolean);
    return obj;
  });
}

const getVendors = catchAsync(async (req, res) => {
  const { city, locality, specialization, sort, featured } = req.query;

  const filter = { isApproved: true, isListingEnabled: true };
  // A city match must check BOTH a vendor's free-text business-address city
  // (location.city) AND every city in their serviceLocations array — a
  // vendor whose home base is Bengaluru but who also services Mysuru should
  // still turn up when someone filters by Mysuru. This used to only ever
  // check location.city, silently missing every serviceLocations-only match.
  // `locality` (no dedicated field on Vendor yet) is folded into the same
  // OR as an extra term, in case a vendor happened to enter a neighborhood
  // name into one of these city fields.
  if (city || locality) {
    const terms = [city, locality].filter(Boolean).map((t) => new RegExp(t, 'i'));
    filter.$or = [
      { 'location.city': { $in: terms } },
      { 'serviceLocations.city': { $in: terms } },
    ];
  }
  if (specialization) filter.specializations = { $in: [new RegExp(specialization, 'i')] };
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

  return success(res, { vendors: await attachCardImages(vendors), total, page, totalPages });
});

const getVendorById = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({
    _id: req.params.id,
    isApproved: true,
    isListingEnabled: true,
  }).populate('userId', 'name phone email');

  if (!vendor) return error(res, 'Vendor not found.', 404);
  return success(res, { vendor });
});

const getVendorsByIds = catchAsync(async (req, res) => {
  const { ids } = req.query;
  if (!ids) return success(res, { vendors: [] });

  const idList = ids.split(',').filter(Boolean).slice(0, 4);
  if (idList.length === 0) return success(res, { vendors: [] });

  const vendors = await Vendor.find({
    _id: { $in: idList },
    isApproved: true,
    isListingEnabled: true,
  }).populate('userId', 'name');

  return success(res, { vendors });
});

const getVendorProjects = catchAsync(async (req, res) => {
  const projects = await Project.find({
    vendorId: req.params.id,
    isPublished: true,
    moderationStatus: 'approved',
  }).sort({ createdAt: -1 });

  return success(res, { projects });
});

const getProjectById = catchAsync(async (req, res) => {
  const project = await Project.findOne({
    _id: req.params.id,
    isPublished: true,
    moderationStatus: 'approved',
  }).populate('vendorId', 'businessName location rating reviewCount profilePhoto isApproved');

  if (!project) return error(res, 'Project not found.', 404);
  return success(res, { project });
});

const getSimilarVendors = catchAsync(async (req, res) => {
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
  const { room, style } = req.query;

  const filter = { isPublished: true, moderationStatus: 'approved' };
  if (room) filter.projectType = { $regex: new RegExp(room, 'i') };
  if (style) filter.style = { $regex: new RegExp(style, 'i') };

  const projects = await Project.find(filter)
    .sort({ completedYear: -1 })
    .limit(50)
    .populate('vendorId', 'businessName location _id');

  return success(res, { projects });
});

const getStats = catchAsync(async (req, res) => {
  const [vendorCount, projectCount, enquiryCount, ratingAgg, featuredCount] = await Promise.all([
    Vendor.countDocuments({ isApproved: true, isListingEnabled: true }),
    Project.countDocuments({ isPublished: true, moderationStatus: 'approved' }),
    Lead.countDocuments(),
    Vendor.aggregate([
      { $match: { isApproved: true, isListingEnabled: true } },
      { $group: { _id: null, avg: { $avg: '$rating' } } },
    ]),
    Vendor.countDocuments({ isFeatured: true, isApproved: true }),
  ]);

  const avgRating = ratingAgg[0]?.avg ? Number(ratingAgg[0].avg).toFixed(1) : '4.8';

  return success(res, { vendorCount, projectCount, enquiryCount, avgRating, featuredCount });
});

const getFeaturedProjects = catchAsync(async (req, res) => {
  const featured = await Project.find({ isFeatured: true, isPublished: true, moderationStatus: 'approved' })
    .populate('vendorId', 'businessName')
    .sort({ createdAt: -1 })
    .limit(8);

  let projects = featured;
  if (projects.length < 4) {
    const excludeIds = projects.map((p) => p._id);
    const fillers = await Project.find({
      _id: { $nin: excludeIds },
      isPublished: true,
      moderationStatus: 'approved',
    })
      .populate('vendorId', 'businessName')
      .sort({ createdAt: -1 })
      .limit(8 - projects.length);
    projects = [...projects, ...fillers];
  }

  return success(res, { projects });
});

const getRelatedProjects = catchAsync(async (req, res) => {
  const current = await Project.findById(req.params.id);
  if (!current) return error(res, 'Project not found.', 404);

  const sameType = await Project.find({
    _id: { $ne: current._id },
    projectType: current.projectType,
    isPublished: true,
    moderationStatus: 'approved',
  })
    .populate('vendorId', 'businessName')
    .sort({ createdAt: -1 })
    .limit(4);

  let projects = sameType;
  if (projects.length < 4) {
    const excludeIds = [current._id, ...projects.map((p) => p._id)];
    const fillers = await Project.find({
      _id: { $nin: excludeIds },
      isPublished: true,
      moderationStatus: 'approved',
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
  { path: 'leadId', select: 'projectType city' },
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
  userName: shapeReviewerName(r.userId?.name),
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

module.exports = { getVendors, getVendorById, getVendorsByIds, getVendorProjects, getProjectById, getSimilarVendors, getGallery, getStats, getFeaturedProjects, getRelatedProjects, getHomepageContent, getSiteReviews, getStyleCounts };
