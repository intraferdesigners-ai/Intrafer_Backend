const express = require('express');
const { getPlans, createOrder, verifyPayment, getMyPlan, checkCoupon, getSubscriptionHistory, downloadInvoice } = require('../controllers/subscription.controller');
const { protect } = require('../middleware/auth');
const rbac = require('../middleware/rbac');

const router = express.Router();

// NOTE: the /webhook route is intentionally NOT mounted here. It needs the raw,
// unparsed request body for Razorpay's HMAC signature check, so it's registered
// directly in app.js (with express.raw()) before the global express.json()
// middleware runs. See app.js for /api/subscriptions/webhook.

router.get('/plans',           getPlans);
router.post('/create-order',   protect, rbac('vendor'), createOrder);
router.post('/verify-payment', protect, rbac('vendor'), verifyPayment);
router.post('/check-coupon',   protect, rbac('vendor'), checkCoupon);
router.get('/my-plan',         protect, rbac('vendor'), getMyPlan);
router.get('/history',         protect, rbac('vendor'), getSubscriptionHistory);
router.get('/:id/invoice',     protect, rbac('vendor'), downloadInvoice);

module.exports = router;
