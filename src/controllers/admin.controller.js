const Vendor = require('../models/Vendor.model');
const User = require('../models/User.model');
const Lead = require('../models/Lead.model');
const Subscription = require('../models/Subscription.model');
const Notification = require('../models/Notification.model');
const Settings = require('../models/Settings.model');
const AuditLog = require('../models/AuditLog.model');
const Project = require('../models/Project.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const paginate = require('../utils/paginate');
const { sendVendorApprovedEmail, sendVendorRejectedEmail } = require('../services/email.service');
const { PERMISSION_KEYS } = require('../constants/permissions');

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
  max_leads_per_vendor: 10,
  homepage_hero_subtitle: "Compare vetted interior designers by city, style, and budget. Every portfolio shown is real, completed work — submit one enquiry and hear back within two days.",
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

// Admin staff management — all three handlers are gated on req.user.isSuperAdmin
// directly (see admin.routes.js), NOT via requirePermission/adminPermissions,
// since granting that ability through a regular permission flag would let a
// non-super-admin escalate their own or others' privileges.

const getAdminUsers = catchAsync(async (req, res) => {
  const admins = await User.find({ role: 'admin' })
    .select('name email phone isSuperAdmin adminPermissions createdAt')
    .sort({ createdAt: -1 });
  return success(res, { admins });
});

const createAdminUser = catchAsync(async (req, res) => {
  const { name, email, phone, password, adminPermissions, isSuperAdmin } = req.body;

  if (!name || !email || !phone || !password) {
    return error(res, 'name, email, phone, and password are required.', 400);
  }

  const existing = await User.findOne({ $or: [{ email }, { phone }] });
  if (existing) return error(res, 'Email or phone already registered.', 409);

  const permissions = Array.isArray(adminPermissions)
    ? adminPermissions.filter((p) => PERMISSION_KEYS.includes(p))
    : [];

  const admin = await User.create({
    name,
    email,
    phone,
    passwordHash: password,
    role: 'admin',
    isEmailVerified: true,
    isPhoneVerified: true,
    isSuperAdmin: !!isSuperAdmin,
    adminPermissions: permissions,
  });

  return success(res, {
    admin: {
      id: admin._id,
      name: admin.name,
      email: admin.email,
      phone: admin.phone,
      isSuperAdmin: admin.isSuperAdmin,
      adminPermissions: admin.adminPermissions,
      createdAt: admin.createdAt,
    },
  }, 'Admin user created.', 201);
});

const updateAdminPermissions = catchAsync(async (req, res) => {
  const { adminPermissions, isSuperAdmin } = req.body;

  const target = await User.findOne({ _id: req.params.id, role: 'admin' });
  if (!target) return error(res, 'Admin user not found.', 404);

  // Don't allow a super admin to demote themselves if they're the last one —
  // otherwise the platform could lock everyone out of admin-user management.
  if (target._id.equals(req.user._id) && target.isSuperAdmin && isSuperAdmin === false) {
    const otherSuperAdmins = await User.countDocuments({
      role: 'admin', isSuperAdmin: true, _id: { $ne: target._id },
    });
    if (otherSuperAdmins === 0) {
      return error(res, 'You are the last super admin — promote another admin before demoting yourself.', 400);
    }
  }

  if (adminPermissions !== undefined) {
    target.adminPermissions = Array.isArray(adminPermissions)
      ? adminPermissions.filter((p) => PERMISSION_KEYS.includes(p))
      : [];
  }
  if (isSuperAdmin !== undefined) target.isSuperAdmin = !!isSuperAdmin;

  await target.save();

  return success(res, {
    admin: {
      id: target._id,
      name: target.name,
      email: target.email,
      phone: target.phone,
      isSuperAdmin: target.isSuperAdmin,
      adminPermissions: target.adminPermissions,
      createdAt: target.createdAt,
    },
  }, 'Admin permissions updated.');
});

const getAuditLogs = catchAsync(async (req, res) => {
  const total = await AuditLog.countDocuments();
  const { skip, limit, page, totalPages } = paginate(req.query, total);

  const logs = await AuditLog.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  return success(res, { logs, total, page, totalPages });
});

// Shared by getRevenueReport/exportRevenueReport — defaults to the last 12
// months when `from`/`to` aren't given, and extends `to` through the end of
// its calendar day so a same-day range isn't emptied by the time component.
const parseRevenueRange = (query) => {
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setMonth(defaultFrom.getMonth() - 12);

  const from = query.from ? new Date(query.from) : defaultFrom;

  let to;
  if (query.to) {
    to = new Date(query.to);
    to.setHours(23, 59, 59, 999);
  } else {
    to = now;
  }

  return { from, to };
};

const getRevenueReport = catchAsync(async (req, res) => {
  const { from, to } = parseRevenueRange(req.query);
  const match = { status: { $in: ['active', 'expired'] }, startDate: { $gte: from, $lte: to } };

  const [summaryResult, monthly, byPlan, topCoupons] = await Promise.all([
    Subscription.aggregate([
      { $match: match },
      { $group: {
        _id: null,
        grossRevenue: { $sum: '$planPrice' },
        totalDiscounts: { $sum: '$discountAmount' },
        transactionCount: { $sum: 1 },
      }},
    ]),
    Subscription.aggregate([
      { $match: match },
      { $group: {
        _id: { year: { $year: '$startDate' }, month: { $month: '$startDate' } },
        grossRevenue: { $sum: '$planPrice' },
        netRevenue: { $sum: { $subtract: ['$planPrice', { $ifNull: ['$discountAmount', 0] }] } },
        transactionCount: { $sum: 1 },
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      { $project: {
        _id: 0, year: '$_id.year', month: '$_id.month',
        grossRevenue: 1, netRevenue: 1, transactionCount: 1,
      }},
    ]),
    Subscription.aggregate([
      { $match: match },
      { $group: {
        _id: '$planName',
        transactionCount: { $sum: 1 },
        grossRevenue: { $sum: '$planPrice' },
        netRevenue: { $sum: { $subtract: ['$planPrice', { $ifNull: ['$discountAmount', 0] }] } },
      }},
      { $project: { _id: 0, planName: '$_id', transactionCount: 1, grossRevenue: 1, netRevenue: 1 } },
    ]),
    Subscription.aggregate([
      { $match: { ...match, couponCode: { $nin: ['', null] } } },
      { $group: {
        _id: '$couponCode',
        useCount: { $sum: 1 },
        totalDiscountGiven: { $sum: '$discountAmount' },
      }},
      { $sort: { useCount: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, couponCode: '$_id', useCount: 1, totalDiscountGiven: 1 } },
    ]),
  ]);

  const grossRevenue = summaryResult[0]?.grossRevenue ?? 0;
  const totalDiscounts = summaryResult[0]?.totalDiscounts ?? 0;

  return success(res, {
    summary: {
      grossRevenue,
      totalDiscounts,
      netRevenue: grossRevenue - totalDiscounts,
      transactionCount: summaryResult[0]?.transactionCount ?? 0,
    },
    monthly,
    byPlan,
    topCoupons,
  });
});

const escapeCsvField = (value) => {
  const str = String(value ?? '');
  return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
};

const exportRevenueReport = catchAsync(async (req, res) => {
  const { from, to } = parseRevenueRange(req.query);

  const subscriptions = await Subscription.find({
    status: { $in: ['active', 'expired'] },
    startDate: { $gte: from, $lte: to },
  })
    .populate('vendorId', 'businessName')
    .sort({ startDate: 1 });

  const header = ['Date', 'Vendor', 'Plan', 'Gross Amount', 'Discount', 'Net Amount', 'Coupon Code', 'Status'];
  const rows = subscriptions.map((sub) => [
    sub.startDate ? sub.startDate.toISOString().slice(0, 10) : '',
    sub.vendorId?.businessName || '',
    sub.planName,
    sub.planPrice,
    sub.discountAmount || 0,
    (sub.planPrice || 0) - (sub.discountAmount || 0),
    sub.couponCode || '',
    sub.status,
  ].map(escapeCsvField).join(','));

  const csv = [header.join(','), ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="revenue-report.csv"');
  res.send(csv);
});

const getPendingProjects = catchAsync(async (req, res) => {
  const filter = { moderationStatus: 'pending' };
  const total = await Project.countDocuments(filter);
  const { skip, limit, page, totalPages } = paginate(req.query, total);

  const projects = await Project.find(filter)
    .populate('vendorId', 'businessName location')
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit);

  return success(res, { projects, total, page, totalPages });
});

const moderateProject = catchAsync(async (req, res) => {
  const { approve, rejectionReason } = req.body;

  const updates = approve
    ? { moderationStatus: 'approved', rejectionReason: '' }
    : { moderationStatus: 'rejected', rejectionReason };

  if (!approve && !rejectionReason) {
    return error(res, 'A rejection reason is required.', 400);
  }

  const project = await Project.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!project) return error(res, 'Project not found.', 404);

  return success(res, { project }, approve ? 'Project approved.' : 'Project rejected.');
});

const getAllProjects = catchAsync(async (req, res) => {
  const { status, vendorId, search } = req.query;

  const filter = {};
  if (status) filter.moderationStatus = status;
  if (vendorId) filter.vendorId = vendorId;
  if (search) filter.title = { $regex: search, $options: 'i' };

  const total = await Project.countDocuments(filter);
  const { skip, limit, page, totalPages } = paginate(req.query, total);

  const projects = await Project.find(filter)
    .populate('vendorId', 'businessName')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  return success(res, { projects, total, page, totalPages });
});

const getAllSubscriptions = catchAsync(async (req, res) => {
  const { status, planName, search } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (planName) filter.planName = planName;
  if (search) {
    const matchingVendors = await Vendor.find({ businessName: { $regex: search, $options: 'i' } }).select('_id');
    filter.vendorId = { $in: matchingVendors.map((v) => v._id) };
  }

  const total = await Subscription.countDocuments(filter);
  const { skip, limit, page, totalPages } = paginate(req.query, total);

  const subscriptions = await Subscription.find(filter)
    .populate('vendorId', 'businessName')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  return success(res, { subscriptions, total, page, totalPages });
});

const toggleProjectFeatured = catchAsync(async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return error(res, 'Project not found.', 404);
  project.isFeatured = !project.isFeatured;
  await project.save();
  return success(res, { isFeatured: project.isFeatured },
    project.isFeatured ? 'Project featured.' : 'Feature removed.');
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
  getAdminUsers,
  createAdminUser,
  updateAdminPermissions,
  getAuditLogs,
  getRevenueReport,
  exportRevenueReport,
  getPendingProjects,
  moderateProject,
  getAllProjects,
  getAllSubscriptions,
  toggleProjectFeatured,
};
