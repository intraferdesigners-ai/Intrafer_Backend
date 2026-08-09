const mongoose = require('mongoose');
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
    contactName: req.user.name,
    contactEmail: req.user.email,
    contactPhone: req.user.phone,
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
  notifService.dispatch('ENQUIRY_CREATED', { user: req.user, vendor, lead });

  return success(res, { lead }, 'Enquiry submitted successfully.', 201);
});

const getVendorLeads = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  const filter = { vendorId: vendor._id };
  if (req.query.status) filter.status = req.query.status;

  const leads = await Lead.find(filter)
    .select('-contactEmail -contactPhone')
    .sort({ createdAt: -1 });

  return success(res, { leads });
});

const getLeadById = catchAsync(async (req, res) => {
  // Guards against a raw Mongoose CastError (500, leaking an internal
  // message) for any non-ObjectId path segment — including "user", now that
  // GET /leads/user was removed as its own route (see the homeowner-removal
  // plan, Phase 5) and falls through to this one instead.
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return error(res, 'Lead not found.', 404);
  }

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

  await lead.populate('vendorId', 'businessName location rating');

  const leadObj = lead.toObject();
  if (!contactRevealed) {
    leadObj.contactEmail = '';
    leadObj.contactPhone = '';
  }

  return success(res, { lead: leadObj });
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

  // Guest enquiries (see enquiry.controller.js) have no userId — nothing to
  // notify, so this whole block is skipped rather than dereferencing a null
  // ref. Notification.recipientId is a required User ref, so there'd be
  // nowhere to send LEAD_ACCEPTED to anyway.
  if (lead.userId) {
    await lead.populate('userId', 'name email phone');

    // Fetched separately (rather than widening the populate above) so the
    // notification-preference fields aren't leaked into the API response.
    const notifyPrefs = await User.findById(lead.userId._id).select('emailNotifications notificationPreferences').lean();
    notifService.dispatch('LEAD_ACCEPTED', {
      user: { ...lead.userId.toObject(), ...notifyPrefs },
      vendor,
      lead,
    });
  }

  return success(res, { lead }, 'Lead accepted. Contact details are now visible.');
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

module.exports = {
  createLead, getVendorLeads, getLeadById, acceptLead, updateLeadStatus,
  CONTACT_REVEALED_STATUSES,
};
