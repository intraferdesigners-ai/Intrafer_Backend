const PDFDocument = require('pdfkit');
const Vendor = require('../models/Vendor.model');
const Subscription = require('../models/Subscription.model');
const User = require('../models/User.model');
const Coupon = require('../models/Coupon.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const razorpayService = require('../services/razorpay.service');
const notifService = require('../services/notification.service');
const { validateCoupon } = require('./coupon.controller');

const formatINR = (amountInPaisa) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amountInPaisa / 100);

const generateInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const invoiceNumber = `INV-${year}-${suffix}`;
    const exists = await Subscription.exists({ invoiceNumber });
    if (!exists) return invoiceNumber;
  }
};

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
  const { planName, couponCode } = req.body;

  const plan = PLANS.find((p) => p.name === planName);
  if (!plan) return error(res, 'Invalid plan.', 400);

  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  let amount = plan.price;
  let discountAmount = 0;
  let appliedCouponCode = '';

  if (couponCode) {
    const result = await validateCoupon(couponCode, planName, plan.price);
    if (!result.valid) return error(res, result.reason, 400);
    discountAmount = result.discountAmount;
    amount = plan.price - discountAmount;
    appliedCouponCode = result.coupon.code;
  }

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
      amount,
      receipt: `rcpt_${vendor._id.toString().slice(-8)}_${Date.now().toString().slice(-8)}`,
      notes: { vendorId: vendor._id.toString(), planName, couponCode: appliedCouponCode },
    });
  } catch (err) {
    console.error('[Razorpay] createOrder error:', err.error?.description || err.message, err.stack);
    return error(res, 'Unable to create payment order. Please try again.', 502);
  }

  await Subscription.create({
    vendorId: vendor._id,
    planName: plan.name,
    planPrice: amount,
    leadsPerMonth: plan.leadsPerMonth,
    razorpayOrderId: order.id,
    status: 'pending',
    couponCode: appliedCouponCode,
    discountAmount,
  });

  return success(res, {
    orderId: order.id,
    amount,
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

  // Idempotent: the webhook may have already activated this subscription by the
  // time this client-side call arrives — activateFromPayment is a no-op if so.
  await activateFromPayment({ orderId: razorpay_order_id, paymentId: razorpay_payment_id });
  const updatedSub = await Subscription.findById(sub._id);

  return success(res, { subscription: updatedSub }, 'Subscription activated. Your listing is now live.');
});

const getMyPlan = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  const subscription = await Subscription.findOne({ vendorId: vendor._id, status: 'active' });
  return success(res, { subscription, isActive: !!subscription });
});

const checkCoupon = catchAsync(async (req, res) => {
  const { code, planName } = req.body;
  if (!code) return error(res, 'Coupon code is required.', 400);

  const plan = PLANS.find((p) => p.name === planName);
  if (!plan) return error(res, 'Invalid plan.', 400);

  const result = await validateCoupon(code, planName, plan.price);
  if (!result.valid) return error(res, result.reason, 400);

  return success(res, {
    originalAmount: plan.price,
    discountAmount: result.discountAmount,
    finalAmount: plan.price - result.discountAmount,
    discountType: result.coupon.discountType,
    discountValue: result.coupon.discountValue,
  });
});

const getSubscriptionHistory = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  const subscriptions = await Subscription.find({ vendorId: vendor._id }).sort({ createdAt: -1 });
  return success(res, { subscriptions });
});

const downloadInvoice = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ userId: req.user._id });
  if (!vendor) return error(res, 'Vendor profile not found.', 404);

  const sub = await Subscription.findOne({ _id: req.params.id, vendorId: vendor._id });
  if (!sub) return error(res, 'Subscription not found.', 404);

  // invoiceNumber is only ever assigned the first time a subscription goes
  // active, so its presence — not the current status — is what tells us an
  // invoice exists (a since-expired or cancelled plan should stay downloadable).
  if (!sub.invoiceNumber) {
    return error(res, 'No invoice available for this subscription.', 400);
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${sub.invoiceNumber}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  const invoiceDate = new Date(sub.startDate).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  // Biller header
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#000').text('Intrafer');
  doc.fontSize(9).font('Helvetica').fillColor('#555')
    .text('support@intrafer.in')
    .text('GST registration in progress');

  // Invoice meta (top right)
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#000').text('INVOICE', 50, 50, { align: 'right' });
  doc.fontSize(9).font('Helvetica').fillColor('#555')
    .text(`Invoice #: ${sub.invoiceNumber}`, { align: 'right' })
    .text(`Invoice date: ${invoiceDate}`, { align: 'right' });

  doc.moveDown(2);

  // Bill to
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text('Billed to');
  doc.font('Helvetica').fontSize(10).fillColor('#333').text(vendor.businessName);
  const location = [vendor.location?.city, vendor.location?.state].filter(Boolean).join(', ');
  if (location) doc.text(location);

  doc.moveDown(2);

  // Line-item table
  const tableTop = doc.y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  doc.text('Description', 50, tableTop);
  doc.text('Payment ID', 280, tableTop);
  doc.text('Amount', 460, tableTop, { width: 90, align: 'right' });
  doc.moveTo(50, tableTop + 16).lineTo(550, tableTop + 16).strokeColor('#cccccc').stroke();

  const rowY = tableTop + 26;
  doc.font('Helvetica').fontSize(10).fillColor('#333');
  doc.text(`${sub.planName} Plan Subscription`, 50, rowY, { width: 220 });
  doc.text(sub.razorpayPaymentId || '—', 280, rowY, { width: 170 });
  doc.text(formatINR(sub.planPrice), 460, rowY, { width: 90, align: 'right' });

  doc.moveTo(50, rowY + 24).lineTo(550, rowY + 24).strokeColor('#cccccc').stroke();

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000');
  doc.text('Total', 350, rowY + 34, { width: 110, align: 'right' });
  doc.text(formatINR(sub.planPrice), 460, rowY + 34, { width: 90, align: 'right' });

  doc.moveDown(6);
  doc.font('Helvetica').fontSize(8).fillColor('#999')
    .text('This is a computer-generated invoice and does not require a signature.', 50, doc.y, { align: 'center', width: 500 });

  doc.end();
});

const activateFromPayment = async ({ orderId, paymentId }) => {
  const sub = await Subscription.findOne({ razorpayOrderId: orderId });
  if (!sub || sub.status === 'active') return; // already active (e.g. client-side verify already ran) — idempotent no-op

  const plan = PLANS.find((p) => p.name === sub.planName);
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

  sub.status = 'active';
  sub.razorpayPaymentId = paymentId;
  sub.startDate = startDate;
  sub.endDate = endDate;
  if (!sub.invoiceNumber) {
    sub.invoiceNumber = await generateInvoiceNumber();
  }
  await sub.save();

  // Guarded by the status==='active' early-return above (same pattern as the
  // invoiceNumber assignment) so a racing webhook/client-verify pair can't
  // double-count a redemption.
  if (sub.couponCode) {
    await Coupon.updateOne({ code: sub.couponCode }, { $inc: { usedCount: 1 } });
  }

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
};

// Server-to-server source of truth for payment state. Runs even if the client
// never calls /verify-payment (tab closed, network drop, etc). Mounted in app.js
// with express.raw() BEFORE the global JSON body parser so the exact byte payload
// is available for HMAC signature verification.
const handleWebhook = async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];

  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.error('[Razorpay Webhook] RAZORPAY_WEBHOOK_SECRET is not configured.');
    return res.status(500).json({ success: false, message: 'Webhook not configured.' });
  }

  const isValid = razorpayService.verifyWebhookSignature(req.body, signature);
  if (!isValid) {
    console.error('[Razorpay Webhook] Invalid signature — rejecting.');
    return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    console.error('[Razorpay Webhook] Malformed payload:', err.message);
    return res.status(400).json({ success: false, message: 'Malformed payload.' });
  }

  try {
    const event = payload.event;

    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = payload.payload?.payment?.entity;
      if (paymentEntity?.order_id) {
        await activateFromPayment({ orderId: paymentEntity.order_id, paymentId: paymentEntity.id });
      }
    } else if (event === 'payment.failed') {
      const paymentEntity = payload.payload?.payment?.entity;
      if (paymentEntity?.order_id) {
        await Subscription.findOneAndUpdate(
          { razorpayOrderId: paymentEntity.order_id, status: 'pending' },
          { status: 'failed' }
        );
      }
    }
  } catch (err) {
    // Log and still 200 the event — Razorpay retries on non-2xx, and a processing
    // bug shouldn't cause indefinite webhook retries. Investigate via logs instead.
    console.error('[Razorpay Webhook] Processing error:', err.message, err.stack);
  }

  return res.status(200).json({ success: true });
};

module.exports = { getPlans, createOrder, verifyPayment, getMyPlan, checkCoupon, getSubscriptionHistory, downloadInvoice, handleWebhook };
