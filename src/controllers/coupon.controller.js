const Coupon = require('../models/Coupon.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const { findPlan } = require('../config/plans');

// applicablePlans may only name plans that are currently sold; a legacy or
// misspelled name would silently make the coupon apply to nothing. Returns an
// error message or null.
const invalidApplicablePlans = (applicablePlans) => {
  if (applicablePlans === undefined) return null;
  if (!Array.isArray(applicablePlans)) return 'applicablePlans must be a list of plan names.';
  const bad = applicablePlans.filter((name) => !findPlan(name)?.sellable);
  return bad.length ? `applicablePlans contains plans that are not currently sold: ${bad.join(', ')}.` : null;
};

const getAllCoupons = catchAsync(async (req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 });
  return success(res, { coupons });
});

const createCoupon = catchAsync(async (req, res) => {
  const { code, discountType, discountValue, maxUses, applicablePlans, validFrom, validUntil, isActive } = req.body;
  if (!code || !discountType || discountValue === undefined) {
    return error(res, 'code, discountType, and discountValue are required.', 400);
  }
  const plansError = invalidApplicablePlans(applicablePlans);
  if (plansError) return error(res, plansError, 400);

  const normalizedCode = code.toUpperCase().trim();
  const existing = await Coupon.findOne({ code: normalizedCode });
  if (existing) return error(res, 'A coupon with this code already exists.', 400);

  const coupon = await Coupon.create({
    code: normalizedCode,
    discountType,
    discountValue,
    maxUses: maxUses !== undefined && maxUses !== '' ? maxUses : null,
    applicablePlans: applicablePlans || [],
    validFrom: validFrom || Date.now(),
    validUntil: validUntil || null,
    isActive: isActive !== undefined ? isActive : true,
  });

  return success(res, { coupon }, 'Coupon created.', 201);
});

const updateCoupon = catchAsync(async (req, res) => {
  const { code, discountType, discountValue, maxUses, applicablePlans, validFrom, validUntil, isActive } = req.body;
  const plansError = invalidApplicablePlans(applicablePlans);
  if (plansError) return error(res, plansError, 400);

  const updates = {};
  if (code !== undefined) updates.code = code.toUpperCase().trim();
  if (discountType !== undefined) updates.discountType = discountType;
  if (discountValue !== undefined) updates.discountValue = discountValue;
  if (maxUses !== undefined) updates.maxUses = maxUses === '' ? null : maxUses;
  if (applicablePlans !== undefined) updates.applicablePlans = applicablePlans;
  if (validFrom !== undefined) updates.validFrom = validFrom;
  if (validUntil !== undefined) updates.validUntil = validUntil === '' ? null : validUntil;
  if (isActive !== undefined) updates.isActive = isActive;

  const coupon = await Coupon.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!coupon) return error(res, 'Coupon not found.', 404);

  return success(res, { coupon }, 'Coupon updated.');
});

const deleteCoupon = catchAsync(async (req, res) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) return error(res, 'Coupon not found.', 404);
  return success(res, {}, 'Coupon deleted.');
});

// Internal helper — not a route handler. Imported directly by
// subscription.controller.js for both createOrder and the check-coupon preview.
const validateCoupon = async (code, planName, planPrice) => {
  if (!code) return { valid: false, reason: 'Coupon code is required.' };

  const coupon = await Coupon.findOne({ code: code.toUpperCase().trim() });
  if (!coupon || !coupon.isActive) {
    return { valid: false, reason: 'Invalid coupon code.' };
  }

  const now = new Date();
  if (coupon.validFrom && now < coupon.validFrom) {
    return { valid: false, reason: 'This coupon is not active yet.' };
  }
  if (coupon.validUntil && now > coupon.validUntil) {
    return { valid: false, reason: 'This coupon has expired.' };
  }
  if (coupon.maxUses !== null && coupon.maxUses !== undefined && coupon.usedCount >= coupon.maxUses) {
    return { valid: false, reason: 'This coupon has reached its usage limit.' };
  }
  if (coupon.applicablePlans?.length > 0 && !coupon.applicablePlans.includes(planName)) {
    return { valid: false, reason: 'This coupon is not applicable to the selected plan.' };
  }

  // A flat discount that covers the whole price (e.g. one sized for an older,
  // higher price) is rejected rather than clamped down to a ₹1 order.
  if (coupon.discountType === 'flat' && coupon.discountValue >= planPrice) {
    return { valid: false, reason: 'This coupon is not applicable to the selected plan.' };
  }

  let discountAmount = coupon.discountType === 'percentage'
    ? Math.round((planPrice * coupon.discountValue) / 100)
    : coupon.discountValue;

  // Floor at ₹1 (100 paise) payable so the discounted amount is never zero/negative.
  discountAmount = Math.max(0, Math.min(discountAmount, planPrice - 100));

  return { valid: true, discountAmount, coupon };
};

module.exports = { getAllCoupons, createCoupon, updateCoupon, deleteCoupon, validateCoupon };
