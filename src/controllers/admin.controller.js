const Vendor = require('../models/Vendor.model');
const User = require('../models/User.model');
const Lead = require('../models/Lead.model');
const Subscription = require('../models/Subscription.model');
const Notification = require('../models/Notification.model');
const Settings = require('../models/Settings.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const paginate = require('../utils/paginate');
const { sendVendorApprovedEmail, sendVendorRejectedEmail } = require('../services/email.service');

const SETTINGS_DEFAULTS = {
  site_name: 'Intrafer',
  site_tagline: 'Find. Compare. Design.',
  support_email: 'support@intrafer.in',
  support_phone: '+91 98765 00000',
  whatsapp_number: '919876500000',
  lead_expiry_hours: 48,
  popup_delay_seconds: 20,
  popup_retry_minutes: 1,
  maintenance_mode: false,
  allow_new_registrations: true,
  max_leads_per_vendor_basic: 5,
  max_leads_per_vendor_pro: 15,
};

const getVendors = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.approved !== undefined) filter.isApproved = req.query.approved === 'true';

  const total = await Vendor.countDocuments(filter);
  const { skip, limit, page, totalPages } = paginate(req.query, total);

  const vendors = await Vendor.find(filter)
    .populate('userId', 'name email phone')
    .populate('subscriptionId', 'planName status endDate')
    .skip(skip)
    .limit(limit);

  return success(res, { vendors, total, page, totalPages });
});

const approveVendor = catchAsync(async (req, res) => {
  const { approve, rejectionReason } = req.body;

  const vendor = await Vendor.findById(req.params.id).populate('userId', 'name email');
  if (!vendor) return error(res, 'Vendor not found.', 404);

  vendor.isApproved = approve;
  if (!approve && rejectionReason) vendor.rejectionReason = rejectionReason;
  if (approve) vendor.rejectionReason = '';
  await vendor.save();

  if (vendor.userId?.email) {
    if (approve) {
      sendVendorApprovedEmail({
        to: vendor.userId.email,
        name: vendor.userId.name,
        businessName: vendor.businessName,
      }).catch(() => {});
    } else {
      sendVendorRejectedEmail({
        to: vendor.userId.email,
        name: vendor.userId.name,
        businessName: vendor.businessName,
        rejectionReason,
      }).catch(() => {});
    }
  }

  const message = approve ? 'Vendor approved.' : 'Vendor rejected.';
  return success(res, { vendor }, message);
});

const toggleFeatured = catchAsync(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) return error(res, 'Vendor not found.', 404);
  vendor.isFeatured = !vendor.isFeatured;
  await vendor.save();
  return success(res, { isFeatured: vendor.isFeatured },
    vendor.isFeatured ? 'Vendor featured.' : 'Feature removed.');
});

const getLeads = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const total = await Lead.countDocuments(filter);
  const { skip, limit, page, totalPages } = paginate(req.query, total);

  const leads = await Lead.find(filter)
    .populate('userId', 'name email phone')
    .populate('vendorId', 'businessName location')
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 });

  return success(res, { leads, total, page, totalPages });
});

const reassignLead = catchAsync(async (req, res) => {
  const { newVendorId } = req.body;

  const lead = await Lead.findById(req.params.id);
  if (!lead) return error(res, 'Lead not found.', 404);
  if (lead.status !== 'new')
    return error(res, 'Only new leads can be reassigned.', 400);

  const vendor = await Vendor.findById(newVendorId);
  if (!vendor || !vendor.isApproved || !vendor.isListingEnabled)
    return error(res, 'Invalid vendor.', 400);

  lead.vendorId = newVendorId;
  lead.statusHistory.push({ status: 'new', changedBy: req.user._id, note: 'Reassigned by admin' });
  await lead.save();

  await Notification.create({
    recipientId: vendor.userId,
    recipientRole: 'vendor',
    type: 'lead_assigned',
    title: 'Lead reassigned to you',
    message: `A new lead for ${lead.projectType} in ${lead.city} has been assigned to you.`,
    channels: ['in_app'],
    metadata: { leadId: lead._id },
  });

  return success(res, { lead }, 'Lead reassigned successfully.');
});

const getAnalytics = catchAsync(async (req, res) => {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const [
    totalVendors,
    totalUsers,
    totalLeads,
    activeSubscriptions,
    revenueResult,
    planBreakdown,
    monthlyLeads,
    featuredCount,
  ] = await Promise.all([
    Vendor.countDocuments({ isApproved: true }),
    User.countDocuments({ role: 'user' }),
    Lead.countDocuments(),
    Subscription.countDocuments({ status: 'active' }),
    Subscription.aggregate([
      { $match: { status: { $in: ['active', 'expired'] } } },
      { $group: { _id: null, totalRevenue: { $sum: '$planPrice' } } },
    ]),
    Subscription.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$planName', count: { $sum: 1 }, revenue: { $sum: '$planPrice' } } },
    ]),
    Lead.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      { $group: {
        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
        count: { $sum: 1 },
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    Vendor.countDocuments({ isFeatured: true, isApproved: true }),
  ]);

  const totalRevenue = revenueResult[0]?.totalRevenue ?? 0;

  return success(res, {
    totalVendors,
    totalUsers,
    totalLeads,
    activeSubscriptions,
    totalRevenue,
    featuredCount,
    planBreakdown,
    monthlyLeads,
  });
});

const getUsers = catchAsync(async (req, res) => {
  const users = await User.find({ role: 'user' })
    .select('-passwordHash -otp -refreshToken')
    .sort({ createdAt: -1 });

  return success(res, { users });
});

const toggleBlockUser = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return error(res, 'User not found.', 404);
  user.isBlocked = !user.isBlocked;
  user.blockReason = req.body?.reason || '';
  await user.save();
  return success(res, { isBlocked: user.isBlocked },
    user.isBlocked ? 'User blocked.' : 'User unblocked.');
});

const getAdminProfile = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).select('-passwordHash -refreshToken -otp');
  if (!user) return error(res, 'User not found.', 404);
  return success(res, { user });
});

const updateAdminProfile = catchAsync(async (req, res) => {
  const { name, phone } = req.body;
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: { name, phone } },
    { new: true, runValidators: true }
  ).select('-passwordHash -refreshToken -otp');
  return success(res, { user }, 'Profile updated.');
});

const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!newPassword || newPassword.length < 8)
    return error(res, 'New password must be at least 8 characters.', 400);

  const user = await User.findById(req.user._id);
  if (!user) return error(res, 'User not found.', 404);

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) return error(res, 'Current password is incorrect.', 400);

  user.passwordHash = newPassword;
  await user.save();

  return success(res, {}, 'Password changed successfully.');
});

const getSettings = catchAsync(async (req, res) => {
  const settings = await Settings.find();

  const result = {};
  settings.forEach((s) => { result[s.key] = s.value; });

  return success(res, { settings: { ...SETTINGS_DEFAULTS, ...result } });
});

const updateSettings = catchAsync(async (req, res) => {
  const updates = req.body;

  const ops = Object.entries(updates).map(([key, value]) =>
    Settings.findOneAndUpdate(
      { key },
      { $set: { key, value } },
      { upsert: true, new: true }
    )
  );
  await Promise.all(ops);

  return success(res, {}, 'Settings saved successfully.');
});

module.exports = {
  getVendors,
  approveVendor,
  toggleFeatured,
  getLeads,
  reassignLead,
  getAnalytics,
  getUsers,
  toggleBlockUser,
  getAdminProfile,
  updateAdminProfile,
  changePassword,
  getSettings,
  updateSettings,
};
