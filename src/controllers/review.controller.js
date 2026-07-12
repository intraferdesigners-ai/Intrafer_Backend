const Review = require('../models/Review.model');
const Lead   = require('../models/Lead.model');
const Vendor = require('../models/Vendor.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');

exports.createReview = catchAsync(async (req, res) => {
  const { leadId, rating, comment } = req.body;

  if (!rating || rating < 1 || rating > 5) return error(res, 'Rating must be between 1 and 5.', 400);

  const lead = await Lead.findById(leadId);
  if (!lead) return error(res, 'Enquiry not found.', 404);
  if (!lead.userId.equals(req.user._id)) return error(res, 'Not authorised.', 403);
  if (lead.status !== 'won') return error(res, 'You can only review completed projects.', 400);

  const existing = await Review.findOne({ leadId });
  if (existing) return error(res, 'You have already reviewed this project.', 409);

  const review = await Review.create({
    leadId, rating, comment: comment?.trim() || '',
    userId: req.user._id,
    vendorId: lead.vendorId,
  });

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

  const reviews = await Review.find({ vendorId: vendor._id })
    .populate('userId', 'name')
    .sort({ createdAt: -1 })
    .limit(20);

  return success(res, { reviews });
});
