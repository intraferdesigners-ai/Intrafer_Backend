const crypto = require('crypto');
const getRazorpay = require('../config/razorpay');

const createOrder = ({ amount, receipt, notes }) => {
  return getRazorpay().orders.create({ amount, currency: 'INR', receipt, notes });
};

const verifyPaymentSignature = ({ orderId, paymentId, signature }) => {
  const body = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');
  return expected === signature;
};

const verifyWebhookSignature = (rawBody, signature) => {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
};

module.exports = { createOrder, verifyPaymentSignature, verifyWebhookSignature };
