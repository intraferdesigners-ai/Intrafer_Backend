const Vendor = require('../models/Vendor.model');
const Project = require('../models/Project.model');
const Lead = require('../models/Lead.model');
const Settings = require('../models/Settings.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const paginate = require('../utils/paginate');

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const SORT_MAP = {
  rating:  { rating: -1 },
  reviews: { reviewCount: -1 },
  newest:  { createdAt: -1 },
  name:    { businessName: 1 },
};

const getVendors = catchAsync(async (req, res) => {
  const { city, specialization, sort, featured } = req.query;

  const filter = { isApproved: true, isListingEnabled: true };
  if (city) filter['location.city'] = { $regex: new RegExp(city, 'i') };
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

  return success(res, { vendors, total, page, totalPages });
});

const getVendorById = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({
    _id: req.params.id,
    isApproved: true,
    isListingEnabled: true,
  }).populate('userId', 'name');

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

  return success(res, { vendors });
});

const getAvailableSlots = catchAsync(async (req, res) => {
  const { date } = req.query;
  if (!date) return error(res, 'A date query param (YYYY-MM-DD) is required.', 400);

  const vendor = await Vendor.findOne({
    _id: req.params.id,
    isApproved: true,
    isListingEnabled: true,
  });
  if (!vendor) return error(res, 'Vendor not found.', 404);

  const dayStart = new Date(`${date}T00:00:00`);
  if (Number.isNaN(dayStart.getTime())) return error(res, 'Invalid date.', 400);
  const weekday = DAY_LABELS[dayStart.getDay()];

  const {
    workingDays = [],
    startTime = '10:00',
    endTime = '18:00',
    slotDurationMinutes = 60,
  } = vendor.availability || {};

  if (!workingDays.includes(weekday)) {
    return success(res, { slots: [], reason: `Vendor is not available on ${weekday}.` });
  }

  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  const candidates = [];
  for (let m = startMinutes; m + slotDurationMinutes <= endMinutes; m += slotDurationMinutes) {
    const slot = new Date(dayStart);
    slot.setHours(Math.floor(m / 60), m % 60, 0, 0);
    candidates.push(slot);
  }

  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const bookedLeads = await Lead.find({
    vendorId: vendor._id,
    isConsultation: true,
    confirmedDateTime: { $gte: dayStart, $lt: dayEnd },
    status: { $nin: ['cancelled', 'lost'] },
  }).select('confirmedDateTime');

  const bookedTimes = new Set(bookedLeads.map((l) => l.confirmedDateTime.getTime()));

  const slots = candidates
    .filter((slot) => !bookedTimes.has(slot.getTime()))
    .map((slot) => slot.toISOString());

  return success(res, { slots });
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

module.exports = { getVendors, getVendorById, getVendorsByIds, getVendorProjects, getProjectById, getSimilarVendors, getAvailableSlots, getGallery, getStats, getFeaturedProjects, getRelatedProjects, getHomepageContent };
