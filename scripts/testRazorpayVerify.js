require('dotenv').config();
const { verifyPaymentSignature, verifyWebhookSignature } = require('../src/services/razorpay.service');

const result1 = verifyPaymentSignature({
  orderId: 'order_fake123',
  paymentId: 'pay_fake456',
  signature: 'totallyfakesignature',
});
console.log('verifyPaymentSignature (fake):', result1, '← expected: false');

const result2 = verifyWebhookSignature('{"event":"payment.captured"}', 'totallyfakewebhooksig');
console.log('verifyWebhookSignature  (fake):', result2, '← expected: false');
