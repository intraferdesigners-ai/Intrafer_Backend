const Vendor = require('../models/Vendor.model');
const Project = require('../models/Project.model');
const Lead = require('../models/Lead.model');
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
  }).sort({ createdAt: -1 });

  return success(res, { projects });
});

const getProjectById = catchAsync(async (req, res) => {
  const project = await Project.findOne({
    _id: req.params.id,
    isPublished: true,
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

  const filter = { isPublished: true };
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
    Project.countDocuments({ isPublished: true }),
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

module.exports = { getVendors, getVendorById, getVendorsByIds, getVendorProjects, getProjectById, getSimilarVendors, getAvailableSlots, getGallery, getStats };
