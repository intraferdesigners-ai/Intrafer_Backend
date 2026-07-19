const Vendor = require('../models/Vendor.model');
const Project = require('../models/Project.model');
const Lead = require('../models/Lead.model');
const Subscription = require('../models/Subscription.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const { getFileUrl } = require('../middleware/upload');

const getProfile = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id }).populate('userId', 'name email phone');
  if (!vendor) return error(res, 'Vendor profile not found.', 404);
  return success(res, { vendor });
});

const updateProfile = catchAsync(async (req, res) => {
  const { businessName, description, specializations, services, location, profilePhoto } = req.body;
  const updates = {};
  if (businessName !== undefined) updates.businessName = businessName;
  if (description !== undefined) updates.description = description;
  if (specializations !== undefined) updates.specializations = specializations;
  if (services !== undefined) updates.services = services;
  if (location !== undefined) updates.location = location;
  // profilePhoto is a URL string returned by POST /api/upload/avatar, uploaded
  // separately as multipart form data — the frontend uploads the file first,
  // then PUTs the resulting URL here alongside the rest of the profile.
  if (profilePhoto !== undefined) updates.profilePhoto = profilePhoto;

  const vendor = await Vendor.findOneAndUpdate(
    { userId: req.user._id },
    updates,
    { new: true, runValidators: true }
  ).populate('userId', 'name email phone');

  if (!vendor) return error(res, 'Vendor profile not found.', 404);
  return success(res, { vendor });
});

const createProject = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  const images = req.files ? req.files.map((f) => getFileUrl(f)) : [];

  const { beforeImageIndex, afterImageIndex, ...rest } = req.body;
  const beforeImage = images[parseInt(beforeImageIndex, 10)] || '';
  const afterImage  = images[parseInt(afterImageIndex, 10)]  || '';

  const project = await Project.create({
    vendorId: vendor._id,
    images,
    beforeImage,
    afterImage,
    sortOrder: Date.now(),
    ...rest,
  });

  return success(res, { project }, 'Project created.', 201);
});

const getProjects = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  const projects = await Project.find({ vendorId: vendor._id })
    .sort({ sortOrder: 1, createdAt: -1 });
  return success(res, { projects });
});

const getProjectById = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  const project = await Project.findOne({ _id: req.params.id, vendorId: vendor._id });
  if (!project) return error(res, 'Project not found.', 404);

  return success(res, { project });
});

const updateProject = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  // existingImages is only sent by the edit form (as a JSON array of retained
  // image URLs) — plain field updates (e.g. the publish toggle) omit it and
  // leave `images`/`beforeImage`/`afterImage` untouched.
  const { existingImages, beforeImageIndex, afterImageIndex, ...rest } = req.body;
  const updates = { ...rest };

  if (existingImages !== undefined) {
    const kept = JSON.parse(existingImages);
    const newImages = req.files ? req.files.map((f) => getFileUrl(f)) : [];
    updates.images = [...kept, ...newImages];

    if (beforeImageIndex !== undefined) updates.beforeImage = newImages[parseInt(beforeImageIndex, 10)] || '';
    if (afterImageIndex  !== undefined) updates.afterImage  = newImages[parseInt(afterImageIndex, 10)]  || '';
  }

  const project = await Project.findOneAndUpdate(
    { _id: req.params.id, vendorId: vendor._id },
    updates,
    { new: true, runValidators: true }
  );

  if (!project) return error(res, 'Project not found.', 404);
  return success(res, { project });
});

const deleteProject = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  const project = await Project.findOneAndDelete({ _id: req.params.id, vendorId: vendor._id });
  if (!project) return error(res, 'Project not found.', 404);

  return success(res, {}, 'Project deleted.');
});

const reorderProjects = catchAsync(async (req, res) => {
  const { projectIds } = req.body;
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor not found.', 404);

  const updates = projectIds.map((id, index) =>
    Project.updateOne(
      { _id: id, vendorId: vendor._id },
      { $set: { sortOrder: index } }
    )
  );
  await Promise.all(updates);

  return success(res, {}, 'Projects reordered.');
});

const getAnalytics = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  const { totalLeads, wonLeads, rating } = vendor;
  const winRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;

  const subscription = await Subscription.findOne({
    vendorId: vendor._id,
    status: 'active',
  });

  let creditsUsed = 0;
  let creditsTotal = 0;
  if (subscription) {
    creditsTotal = subscription.leadsPerMonth || 0;
    const periodStart = subscription.startDate ||
      new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    creditsUsed = await Lead.countDocuments({
      vendorId: vendor._id,
      status: { $in: ['accepted', 'contacted', 'quotation_sent', 'won', 'lost'] },
      updatedAt: { $gte: periodStart },
    });
  }

  return success(res, {
    totalLeads,
    wonLeads,
    winRate: `${winRate}%`,
    rating,
    creditsUsed,
    creditsTotal,
    creditsRemaining: Math.max(0, creditsTotal - creditsUsed),
  });
});

const updateAvailability = catchAsync(async (req, res) => {
  const { workingDays, startTime, endTime, slotDurationMinutes } = req.body;
  const availability = {};
  if (workingDays !== undefined) availability.workingDays = workingDays;
  if (startTime !== undefined) availability.startTime = startTime;
  if (endTime !== undefined) availability.endTime = endTime;
  if (slotDurationMinutes !== undefined) availability.slotDurationMinutes = slotDurationMinutes;

  const vendor = await Vendor.findOneAndUpdate(
    { userId: req.user._id },
    { availability },
    { new: true, runValidators: true }
  );

  if (!vendor) return error(res, 'Vendor profile not found.', 404);
  return success(res, { vendor }, 'Availability updated.');
});

const updateNotes = catchAsync(async (req, res) => {
  const { notes } = req.body;
  const lead = await Lead.findById(req.params.id);
  if (!lead) return error(res, 'Lead not found.', 404);

  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor || !lead.vendorId.equals(vendor._id))
    return error(res, 'Not authorised.', 403);

  lead.vendorNotes = notes;
  await lead.save();
  return success(res, { vendorNotes: lead.vendorNotes }, 'Notes saved.');
});

module.exports = {
  getProfile, updateProfile, updateAvailability,
  createProject, getProjects, getProjectById, updateProject, deleteProject, reorderProjects,
  getAnalytics, updateNotes,
};
