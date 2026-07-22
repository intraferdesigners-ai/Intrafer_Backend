const Lead = require('../models/Lead.model');
const Vendor = require('../models/Vendor.model');
const User = require('../models/User.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const generateEnquiryId = require('../utils/generateEnquiryId');
const leadService = require('../services/lead.service');
const notifService = require('../services/notification.service');

const CONTACT_REVEALED_STATUSES = ['accepted', 'contacted', 'quotation_sent', 'won', 'lost'];

const createLead = catchAsync(async (req, res) => {
  const { vendorId, projectType, budget, city, requirements, isConsultation, preferredDate } = req.body;

  if (req.user?.isBlocked) {
    return error(res, 'Your account has been suspended. Contact support@intrafer.in', 403);
  }

  const vendor = await Vendor.findOne({ _id: vendorId, isApproved: true, isListingEnabled: true });
  if (!vendor) return error(res, 'Vendor not available.', 404);

  const lead = await Lead.create({
    enquiryId: generateEnquiryId(),
    userId: req.user._id,
    vendorId: vendor._id,
    projectType,
    budget,
    city,
    requirements,
    isConsultation: !!isConsultation,
    preferredDate: preferredDate || '',
    statusHistory: [{ status: 'new', changedBy: req.user._id }],
  });

  await Vendor.findByIdAndUpdate(vendor._id, { $inc: { totalLeads: 1 } });

  notifService.dispatch('LEAD_ASSIGNED', { vendor, user: req.user, lead });

  return success(res, { lead }, 'Enquiry submitted successfully.', 201);
});

const getUserLeads = catchAsync(async (req, res) => {
  const leads = await Lead.find({ userId: req.user._id })
    .populate('vendorId', 'businessName location rating')
    .sort({ createdAt: -1 });

  return success(res, { leads });
});

const getVendorLeads = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  const filter = { vendorId: vendor._id };
  if (req.query.status) filter.status = req.query.status;

  const leads = await Lead.find(filter)
    .populate('userId', 'name')
    .sort({ createdAt: -1 });

  return success(res, { leads });
});

const getLeadById = catchAsync(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) return error(res, 'Lead not found.', 404);

  let contactRevealed = false;
  if (req.user.role === 'admin') {
    contactRevealed = true;
  } else if (req.user.role === 'vendor') {
    const vendor = await Vendor.findOne({ userId: req.user._id });
    const isOwner = vendor && lead.vendorId.equals(vendor._id);
    contactRevealed = isOwner && CONTACT_REVEALED_STATUSES.includes(lead.status);
  }

  const userFields = contactRevealed ? 'name email phone' : 'name';
  await lead.populate('userId', userFields);
  await lead.populate('vendorId', 'businessName location rating');

  return success(res, { lead });
});

const acceptLead = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  const lead = await Lead.findOne({ _id: req.params.id, vendorId: vendor._id, status: 'new' });
  if (!lead) return error(res, 'Lead not found or already actioned.', 404);

  lead.status = 'accepted';
  lead.contactRevealedAt = new Date();
  lead.statusHistory.push({ status: 'accepted', changedBy: req.user._id });
  await lead.save();

  await lead.populate('userId', 'name email phone');

  // Fetched separately (rather than widening the populate above) so the
  // notification-preference fields aren't leaked into the API response.
  const notifyPrefs = await User.findById(lead.userId._id).select('emailNotifications notificationPreferences').lean();
  notifService.dispatch('LEAD_ACCEPTED', {
    user: { ...lead.userId.toObject(), ...notifyPrefs },
    vendor,
    lead,
  });

  return success(res, { lead }, 'Lead accepted. Contact details are now visible.');
});

const confirmAppointment = catchAsync(async (req, res) => {
  const { dateTime } = req.body;
  if (!dateTime) return error(res, 'dateTime is required.', 400);

  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  const lead = await Lead.findOne({ _id: req.params.id, vendorId: vendor._id, isConsultation: true });
  if (!lead) return error(res, 'Consultation lead not found.', 404);

  lead.confirmedDateTime = new Date(dateTime);
  if (lead.status === 'new') {
    lead.status = 'accepted';
    lead.contactRevealedAt = new Date();
  }
  lead.statusHistory.push({
    status: lead.status,
    changedBy: req.user._id,
    note: `Appointment confirmed for ${lead.confirmedDateTime.toISOString()}`,
  });
  await lead.save();

  await lead.populate('userId', 'name email phone');

  // Fetched separately (rather than widening the populate above) so the
  // notification-preference fields aren't leaked into the API response.
  const notifyPrefs = await User.findById(lead.userId._id).select('emailNotifications notificationPreferences').lean();
  notifService.dispatch('APPOINTMENT_CONFIRMED', {
    user: { ...lead.userId.toObject(), ...notifyPrefs },
    vendor,
    lead,
  });

  return success(res, { lead }, 'Appointment confirmed.');
});

const updateLeadStatus = catchAsync(async (req, res) => {
  const { status } = req.body;

  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  const lead = await Lead.findOne({ _id: req.params.id, vendorId: vendor._id });
  if (!lead) return error(res, 'Lead not found.', 404);

  lead.status = status;
  lead.statusHistory.push({ status, changedBy: req.user._id });
  await lead.save();

  if (status === 'won') {
    await Vendor.findByIdAndUpdate(vendor._id, { $inc: { wonLeads: 1 } });
  }

  return success(res, { lead }, 'Status updated.');
});

const cancelLead = catchAsync(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, userId: req.user._id });
  if (!lead) return error(res, 'Enquiry not found.', 404);

  const CANCELLABLE = ['new', 'accepted'];
  if (!CANCELLABLE.includes(lead.status)) {
    return error(res, 'This enquiry cannot be cancelled at its current stage.', 400);
  }

  lead.status = 'cancelled';
  lead.statusHistory.push({ status: 'cancelled', changedBy: req.user._id, note: req.body?.reason || '' });
  await lead.save();

  return success(res, { lead }, 'Enquiry cancelled.');
});

module.exports = {
  createLead, getUserLeads, getVendorLeads, getLeadById, acceptLead, confirmAppointment, updateLeadStatus, cancelLead,
  CONTACT_REVEALED_STATUSES,
};
