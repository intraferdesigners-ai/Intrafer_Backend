const crypto = require('crypto');
const Review = require('../models/Review.model');
const Lead   = require('../models/Lead.model');
const Vendor = require('../models/Vendor.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');

// Longer than auth.controller.js's password-reset window (30 minutes) on
// purpose: an enquirer won't necessarily open a "leave a review" email right
// away the way they would a password reset, and unlike a reset link this
// token can't change anything about an account — there's no downside to
// leaving the offer open for a while.
const REVIEW_TOKEN_EXPIRY_DAYS = 30;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Called from lead.controller.js's updateLeadStatus when a lead flips to
// 'won'. Same raw-token/hashed-token/expiry shape as auth.controller.js's
// forgotPassword, just stored on the Lead instead of a User — guest
// enquirers (see enquiry.controller.js) have no User account to store it on.
// Caller is responsible for saving `lead` afterwards.
exports.generateReviewToken = (lead) => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  lead.reviewToken = hashToken(rawToken);
  lead.reviewTokenExpiresAt = new Date(Date.now() + REVIEW_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  return rawToken;
};

const findLeadByReviewToken = async (token) => {
  if (!token) return null;
  return Lead.findOne({
    reviewToken: hashToken(token),
    reviewTokenExpiresAt: { $gt: new Date() },
  }).select('+reviewToken +reviewTokenExpiresAt');
};

// GET /reviews/invite/:token — public. Returns just enough context (vendor
// name, project type) for the landing page to render "Leave a review for
// ${vendorName}" without exposing the lead's contact details.
exports.getReviewInvite = catchAsync(async (req, res) => {
  const lead = await findLeadByReviewToken(req.params.token);
  if (!lead) return error(res, 'This review link is invalid or has expired.', 400);

  const existing = await Review.findOne({ leadId: lead._id });
  if (existing) return error(res, 'This project has already been reviewed.', 409);

  const vendor = await Vendor.findById(lead.vendorId).select('businessName');
  if (!vendor) return error(res, 'Vendor not found.', 404);

  return success(res, {
    vendorName: vendor.businessName,
    projectType: lead.projectType,
    enquiryId: lead.enquiryId,
  });
});

// POST /reviews/invite/:token — public. Single-use: the token is cleared the
// moment a review is created from it, same as resetPassword clearing
// passwordResetToken after a successful reset.
exports.submitReviewViaToken = catchAsync(async (req, res) => {
  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5) return error(res, 'Rating must be between 1 and 5.', 400);

  const lead = await findLeadByReviewToken(req.params.token);
  if (!lead) return error(res, 'This review link is invalid or has expired.', 400);

  const existing = await Review.findOne({ leadId: lead._id });
  if (existing) return error(res, 'This project has already been reviewed.', 409);

  const review = await Review.create({
    leadId: lead._id,
    rating,
    comment: comment?.trim() || '',
    vendorId: lead.vendorId,
  });

  lead.reviewToken = undefined;
  lead.reviewTokenExpiresAt = undefined;
  await lead.save();

  // Recalculate vendor rating
  const agg = await Review.aggregate([
    { $match: { vendorId: lead.vendorId } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  if (agg.length > 0) {
    await Vendor.findByIdAndUpdate(lead.vendorId, {
      rating: Math.round(agg[0].avg * 10) / 10,
      reviewCount: agg[0].count,
    });
  }

  return success(res, { review }, 'Review submitted. Thank you!', 201);
});

exports.getVendorReviews = catchAsync(async (req, res) => {
  const vendor = await Vendor.findById(req.params.vendorId);
  if (!vendor) return error(res, 'Vendor not found.', 404);

  // leadId.contactName is the display-name source for reviews submitted via
  // the token flow (no User at all). userId stays populated too, as the
  // fallback for reviews from before this change, which do have a real User
  // author — see Review.model.js.
  const reviews = await Review.find({ vendorId: vendor._id })
    .populate('leadId', 'contactName')
    .populate('userId', 'name')
    .sort({ createdAt: -1 })
    .limit(20);

  return success(res, { reviews });
});
