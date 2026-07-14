const Vendor = require('../models/Vendor.model');
const Subscription = require('../models/Subscription.model');
const User = require('../models/User.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const razorpayService = require('../services/razorpay.service');
const notifService = require('../services/notification.service');

// price is in paise (matches Razorpay's expected unit and planPrice storage)
const PLANS = [
  { name: '3 Month',  price: 799900,  leadsPerMonth: 10, durationDays: 90  },
  { name: '6 Month',  price: 1499900, leadsPerMonth: 10, durationDays: 180 },
  { name: '12 Month', price: 1999900, leadsPerMonth: 10, durationDays: 365 },
];

const getPlans = catchAsync(async (req, res) => {
  return success(res, { plans: PLANS });
});

const createOrder = catchAsync(async (req, res) => {
  const { planName } = req.body;

  const plan = PLANS.find((p) => p.name === planName);
  if (!plan) return error(res, 'Invalid plan.', 400);

  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.error('[Razorpay] Missing API keys:', {
      key_id: !!process.env.RAZORPAY_KEY_ID,
      key_secret: !!process.env.RAZORPAY_KEY_SECRET,
    });
    return error(res, 'Payment gateway not configured.', 500);
  }

  let order;
  try {
    order = await razorpayService.createOrder({
      amount: plan.price,
      receipt: `rcpt_${vendor._id.toString().slice(-8)}_${Date.now().toString().slice(-8)}`,
      notes: { vendorId: vendor._id.toString(), planName },
    });
  } catch (err) {
    console.error('[Razorpay] createOrder error:', err.error?.description || err.message, err.stack);
    return error(res, 'Unable to create payment order. Please try again.', 502);
  }

  await Subscription.create({
    vendorId: vendor._id,
    planName: plan.name,
    planPrice: plan.price,
    leadsPerMonth: plan.leadsPerMonth,
    razorpayOrderId: order.id,
    status: 'pending',
  });

  return success(res, {
    orderId: order.id,
    amount: plan.price,
    currency: 'INR',
    keyId: process.env.RAZORPAY_KEY_ID,
  });
});

const verifyPayment = catchAsync(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  const valid = razorpayService.verifyPaymentSignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
  });
  if (!valid) return error(res, 'Payment verification failed. Please contact support.', 400);

  const sub = await Subscription.findOne({ razorpayOrderId: razorpay_order_id });
  if (!sub) return error(res, 'Subscription record not found.', 404);

  const plan = PLANS.find((p) => p.name === sub.planName);
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

  sub.status = 'active';
  sub.razorpayPaymentId = razorpay_payment_id;
  sub.startDate = startDate;
  sub.endDate = endDate;
  await sub.save();

  const vendor = await Vendor.findByIdAndUpdate(
    sub.vendorId,
    { isListingEnabled: true, subscriptionId: sub._id },
    { new: true }
  );

  const vendorUser = await User.findById(vendor.userId).select('email');
  notifService.dispatch('PAYMENT_SUCCESS', {
    vendor,
    subscription: sub,
    vendorEmail: vendorUser.email,
  });

  return success(res, { subscription: sub }, 'Subscription activated. Your listing is now live.');
});

const getMyPlan = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  const subscription = await Subscription.findOne({ vendorId: vendor._id, status: 'active' });
  return success(res, { subscription, isActive: !!subscription });
});

module.exports = { getPlans, createOrder, verifyPayment, getMyPlan };
