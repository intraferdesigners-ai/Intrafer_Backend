// Subscription plans and prices: GET /plans offers only the sellable plans,
// create-order charges exactly the server's price (in paise) for a sellable
// plan and rejects legacy/unknown ones, legacy '1 Month' subscriptions still
// activate and expire, coupons are checked against the current prices, and
// an old subscription's invoice keeps the amount it was paid at.
//
// Runs the real app against a throwaway LOCAL Mongo database. Razorpay is
// mocked (razorpay.service.createOrder records the order instead of calling
// the API); keys and secrets are throwaway test values; .env (production) is
// never loaded; notifications and frontend cache purges are stubbed. Needs a
// local mongod — see scripts/testProjectVisibility.js.
//
//   node scripts/testSubscriptionPlans.js [--save-invoice <path.pdf>]

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27099/intrafer_subscription_plans_test';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) {
  console.error(`refusing non-local database: ${URI}`);
  process.exit(1);
}
process.env.JWT_ACCESS_SECRET = 'test-only-jwt-secret';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock_key';
process.env.RAZORPAY_KEY_SECRET = 'test-only-razorpay-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-only-webhook-secret';
const saveInvoiceAt = process.argv.includes('--save-invoice') ? process.argv[process.argv.indexOf('--save-invoice') + 1] : null;

const razorpayService = require('../src/services/razorpay.service');
const orders = [];
razorpayService.createOrder = async ({ amount, receipt, notes }) => {
  const order = { id: `order_mock_${orders.length + 1}`, amount, currency: 'INR', receipt, notes };
  orders.push(order);
  return order;
};
require('../src/services/notification.service').dispatch = () => {};
require('../src/utils/revalidate').purge = async () => true;

// Record every string the invoice PDF draws.
const PDFDocument = require('pdfkit');
const pdfText = [];
const originalText = PDFDocument.prototype.text;
PDFDocument.prototype.text = function text(str, ...rest) {
  pdfText.push(String(str));
  return originalText.call(this, str, ...rest);
};

const app = require('../src/app');
const User = require('../src/models/User.model');
const Vendor = require('../src/models/Vendor.model');
const Subscription = require('../src/models/Subscription.model');
const Coupon = require('../src/models/Coupon.model');
const { PLANS, findPlan } = require('../src/config/plans');
const { expireSubscriptions } = require('../src/jobs/subscriptionExpiry.job');

const DAY = 24 * 60 * 60 * 1000;
// Old list prices, in paise. legacy-price-fixture: what earlier vendors paid.
const OLD_PRICES = [599900, 1499900, 1999900];

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

(async () => {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 3000 });
  } catch (err) {
    console.error(`cannot reach local Mongo at ${URI}: ${err.message}`);
    process.exit(1);
  }
  await mongoose.connection.db.dropDatabase();

  const admin = await User.create({ name: 'Admin', email: 'admin@plans.test', passwordHash: 'x', role: 'admin', isSuperAdmin: true });
  const vUser = await User.create({ name: 'Vendor User', email: 'v@plans.test', passwordHash: 'x', role: 'vendor' });
  const vendor = await Vendor.create({ userId: vUser._id, businessName: 'Plan Test Studio', isApproved: true, location: { city: 'Pune', state: 'Maharashtra' } });

  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const token = (u) => jwt.sign({ id: String(u._id) }, process.env.JWT_ACCESS_SECRET);
  const request = async (method, path, body, user = vUser) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(user && { authorization: `Bearer ${token(user)}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };
  const webhook = async (event, orderId, paymentId) => {
    const raw = JSON.stringify({ event, payload: { payment: { entity: { id: paymentId, order_id: orderId } } } });
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
    const res = await fetch(`${base}/subscriptions/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature }, body: raw,
    });
    assert.strictEqual(res.status, 200);
  };
  const order = async (planName, extra = {}) => request('POST', '/subscriptions/create-order', { planName, ...extra });

  try {
    // ── Plan table ──────────────────────────────────────────────────────
    await test('GET /plans lists exactly the three sellable plans, in paise, legacy hidden', async () => {
      const { status, json } = await request('GET', '/subscriptions/plans', undefined, null);
      assert.strictEqual(status, 200);
      assert.deepStrictEqual(json.data.plans, [
        { name: '3 Month',  displayName: '3 Months',  period: '3 months',  price: 199900, leadsPerMonth: 10, durationDays: 90 },
        { name: '6 Month',  displayName: '6 Months',  period: '6 months',  price: 399900, leadsPerMonth: 10, durationDays: 180 },
        { name: '12 Month', displayName: '12 Months', period: '12 months', price: 799900, leadsPerMonth: 10, durationDays: 365 },
      ]);
    });

    await test("legacy '1 Month' still resolves by name (30 days, not sellable, no price)", async () => {
      const legacy = findPlan('1 Month');
      assert.ok(legacy);
      assert.strictEqual(legacy.sellable, false);
      assert.strictEqual(legacy.durationDays, 30);
      assert.strictEqual(legacy.leadsPerMonth, 10);
      assert.strictEqual(legacy.price, undefined);
    });

    await test('no plan in the table carries an old price; the table is frozen', async () => {
      for (const p of PLANS) assert.ok(!OLD_PRICES.includes(p.price), `${p.name} has old price ${p.price}`);
      assert.ok(Object.isFrozen(PLANS) && PLANS.every(Object.isFrozen));
    });

    // ── create-order ────────────────────────────────────────────────────
    await test('create-order sends Razorpay exactly the server price (paise) for each sellable plan', async () => {
      for (const [name, paise] of [['3 Month', 199900], ['6 Month', 399900], ['12 Month', 799900]]) {
        const { status, json } = await order(name);
        assert.strictEqual(status, 200, JSON.stringify(json));
        const sent = orders.at(-1);
        assert.strictEqual(sent.amount, paise);
        assert.strictEqual(sent.notes.planName, name);
        assert.strictEqual(json.data.amount, paise);
        assert.strictEqual(json.data.orderId, sent.id);
        const sub = await Subscription.findOne({ razorpayOrderId: sent.id });
        assert.strictEqual(sub.planName, name);
        assert.strictEqual(sub.planPrice, paise);
        assert.strictEqual(sub.status, 'pending');
      }
    });

    await test('a client-supplied amount/price is ignored', async () => {
      const { status } = await order('6 Month', { amount: 100, price: 100, planPrice: 100 });
      assert.strictEqual(status, 200);
      assert.strictEqual(orders.at(-1).amount, 399900);
    });

    await test("create-order rejects the legacy '1 Month' plan with a clear 400 and creates nothing", async () => {
      const before = [orders.length, await Subscription.countDocuments()];
      const { status, json } = await order('1 Month');
      assert.strictEqual(status, 400);
      assert.match(json.message, /1 Month plan is no longer available/);
      assert.deepStrictEqual([orders.length, await Subscription.countDocuments()], before);
    });

    await test('create-order rejects unknown plan names (incl. pre-July Basic/Pro/Premium) with 400', async () => {
      for (const name of ['Basic', 'Premium', '', undefined, '3 month']) {
        const { status, json } = await order(name);
        assert.strictEqual(status, 400);
        assert.strictEqual(json.message, 'Invalid plan.');
      }
    });

    await test("check-coupon rejects the legacy '1 Month' plan", async () => {
      await Coupon.create({ code: 'ANY10', discountType: 'percentage', discountValue: 10 });
      const { status, json } = await request('POST', '/subscriptions/check-coupon', { code: 'ANY10', planName: '1 Month' });
      assert.strictEqual(status, 400);
      assert.match(json.message, /no longer available/);
    });

    // ── Activation of legacy and pre-change orders ──────────────────────
    await test("a pending legacy '1 Month' order still activates via webhook: 30 days, stored planPrice kept", async () => {
      const sub = await Subscription.create({ vendorId: vendor._id, planName: '1 Month', planPrice: 599900, leadsPerMonth: 10, razorpayOrderId: 'order_legacy_1m', status: 'pending' });
      await webhook('payment.captured', 'order_legacy_1m', 'pay_legacy_1m');
      const after = await Subscription.findById(sub._id);
      assert.strictEqual(after.status, 'active');
      assert.strictEqual(after.planPrice, 599900);
      assert.ok(after.invoiceNumber);
      assert.strictEqual(Math.round((after.endDate - after.startDate) / DAY), 30);
      assert.strictEqual((await Vendor.findById(vendor._id)).isListingEnabled, true);
    });

    await test("a legacy '1 Month' order also activates via client verify-payment", async () => {
      await Subscription.create({ vendorId: vendor._id, planName: '1 Month', planPrice: 599900, leadsPerMonth: 10, razorpayOrderId: 'order_legacy_verify', status: 'pending' });
      const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update('order_legacy_verify|pay_legacy_verify').digest('hex');
      const { status, json } = await request('POST', '/subscriptions/verify-payment', {
        razorpay_order_id: 'order_legacy_verify', razorpay_payment_id: 'pay_legacy_verify', razorpay_signature: signature,
      });
      assert.strictEqual(status, 200, JSON.stringify(json));
      assert.strictEqual(json.data.subscription.planPrice, 599900);
      assert.strictEqual(json.data.subscription.status, 'active');
    });

    await test("an order placed at the old '6 Month' price activates with 180 days and keeps that price", async () => {
      await Subscription.create({ vendorId: vendor._id, planName: '6 Month', planPrice: 1499900, leadsPerMonth: 10, razorpayOrderId: 'order_old_6m', status: 'pending' });
      await webhook('order.paid', 'order_old_6m', 'pay_old_6m');
      const after = await Subscription.findOne({ razorpayOrderId: 'order_old_6m' });
      assert.strictEqual(after.status, 'active');
      assert.strictEqual(after.planPrice, 1499900);
      assert.strictEqual(Math.round((after.endDate - after.startDate) / DAY), 180);
    });

    await test("expiry cron expires a past-due legacy '1 Month' subscription without touching its price", async () => {
      const past = new Date(Date.now() - 2 * DAY);
      const sub = await Subscription.create({ vendorId: vendor._id, planName: '1 Month', planPrice: 599900, leadsPerMonth: 10, razorpayOrderId: 'order_legacy_exp', status: 'active', startDate: new Date(past - 30 * DAY), endDate: past });
      await expireSubscriptions();
      const after = await Subscription.findById(sub._id);
      assert.strictEqual(after.status, 'expired');
      assert.strictEqual(after.planPrice, 599900);
    });

    // ── Coupons vs the new prices ───────────────────────────────────────
    await test('percentage coupon: 20% of ₹1,999 -> Razorpay gets 159920 paise', async () => {
      await Coupon.create({ code: 'PCT20', discountType: 'percentage', discountValue: 20 });
      const check = await request('POST', '/subscriptions/check-coupon', { code: 'PCT20', planName: '3 Month' });
      assert.deepStrictEqual(
        [check.json.data.originalAmount, check.json.data.discountAmount, check.json.data.finalAmount],
        [199900, 39980, 159920],
      );
      const { status, json } = await order('3 Month', { couponCode: 'PCT20' });
      assert.strictEqual(status, 200);
      assert.strictEqual(orders.at(-1).amount, 159920);
      const sub = await Subscription.findOne({ razorpayOrderId: json.data.orderId });
      assert.deepStrictEqual([sub.planPrice, sub.discountAmount, sub.couponCode], [159920, 39980, 'PCT20']);
    });

    await test('flat coupon smaller than the price: ₹500 off ₹3,999 -> 349900 paise', async () => {
      await Coupon.create({ code: 'FLAT500', discountType: 'flat', discountValue: 50000 });
      const { status } = await order('6 Month', { couponCode: 'FLAT500' });
      assert.strictEqual(status, 200);
      assert.strictEqual(orders.at(-1).amount, 349900);
    });

    await test('flat coupon >= the price is rejected (no ₹0/₹1 orders); still valid on a plan it fits', async () => {
      // Sized for the old prices: ₹5,000 off.
      await Coupon.create({ code: 'FLAT5000', discountType: 'flat', discountValue: 500000 });
      for (const plan of ['3 Month', '6 Month']) {
        const before = orders.length;
        const { status, json } = await order(plan, { couponCode: 'FLAT5000' });
        assert.strictEqual(status, 400, plan);
        assert.match(json.message, /not applicable/);
        assert.strictEqual(orders.length, before);
        const check = await request('POST', '/subscriptions/check-coupon', { code: 'FLAT5000', planName: plan });
        assert.strictEqual(check.status, 400);
      }
      const { status } = await order('12 Month', { couponCode: 'FLAT5000' });
      assert.strictEqual(status, 200);
      assert.strictEqual(orders.at(-1).amount, 299900);

      await Coupon.create({ code: 'FLATEXACT', discountType: 'flat', discountValue: 199900 });
      assert.strictEqual((await order('3 Month', { couponCode: 'FLATEXACT' })).status, 400);
    });

    await test('100% / >100% percentage coupons still floor at ₹1 (100 paise), never 0 or negative', async () => {
      await Coupon.create({ code: 'FREE100', discountType: 'percentage', discountValue: 100 });
      await Coupon.create({ code: 'OVER150', discountType: 'percentage', discountValue: 150 });
      await Coupon.create({ code: 'NEGFLAT', discountType: 'flat', discountValue: -50000 });
      for (const code of ['FREE100', 'OVER150']) {
        assert.strictEqual((await order('3 Month', { couponCode: code })).status, 200);
        assert.strictEqual(orders.at(-1).amount, 100);
      }
      assert.strictEqual((await order('3 Month', { couponCode: 'NEGFLAT' })).status, 200);
      assert.strictEqual(orders.at(-1).amount, 199900); // a negative discount never raises the price
    });

    await test("a stored coupon restricted to '1 Month' applies to no current plan", async () => {
      await Coupon.create({ code: 'OLD1M', discountType: 'percentage', discountValue: 10, applicablePlans: ['1 Month'] });
      for (const plan of ['3 Month', '6 Month', '12 Month']) {
        const { status, json } = await order(plan, { couponCode: 'OLD1M' });
        assert.strictEqual(status, 400);
        assert.match(json.message, /not applicable/);
      }
    });

    await test('admin create/update coupon: applicablePlans must be currently sold plans', async () => {
      const bad = await request('POST', '/admin/coupons', { code: 'NEWBAD', discountType: 'percentage', discountValue: 10, applicablePlans: ['1 Month', '6 Month'] }, admin);
      assert.strictEqual(bad.status, 400);
      assert.match(bad.json.message, /not currently sold: 1 Month/);
      assert.strictEqual(await Coupon.countDocuments({ code: 'NEWBAD' }), 0);

      const ok = await request('POST', '/admin/coupons', { code: 'NEWOK', discountType: 'percentage', discountValue: 10, applicablePlans: ['3 Month', '12 Month'] }, admin);
      assert.strictEqual(ok.status, 201, JSON.stringify(ok.json));

      const old = await Coupon.findOne({ code: 'OLD1M' });
      const upd = await request('PUT', `/admin/coupons/${old._id}`, { applicablePlans: ['1 Month'] }, admin);
      assert.strictEqual(upd.status, 400);
      const fixed = await request('PUT', `/admin/coupons/${old._id}`, { applicablePlans: ['3 Month'] }, admin);
      assert.strictEqual(fixed.status, 200);
      // An update that doesn't touch applicablePlans is unaffected.
      const toggle = await request('PUT', `/admin/coupons/${old._id}`, { isActive: false }, admin);
      assert.strictEqual(toggle.status, 200);
    });

    // ── Invoice for an old subscription ─────────────────────────────────
    await test("invoice for a legacy '1 Month' subscription shows the ₹5,999 it was paid at", async () => {
      const sub = await Subscription.findOne({ razorpayOrderId: 'order_legacy_1m' });
      pdfText.length = 0;
      const res = await fetch(`${base}/subscriptions/${sub._id}/invoice`, { headers: { authorization: `Bearer ${token(vUser)}` } });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
      const pdf = Buffer.from(await res.arrayBuffer());
      assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');
      if (saveInvoiceAt) fs.writeFileSync(saveInvoiceAt, pdf);
      assert.ok(pdfText.includes('1 Month Plan Subscription'), pdfText.join(' | '));
      // Line item and total both show the stored amount (Intl formats ₹5,999).
      const fiveNineNineNine = pdfText.filter((t) => /^₹\s?5,999$/.test(t));
      assert.strictEqual(fiveNineNineNine.length, 2, pdfText.join(' | '));
      assert.ok(!pdfText.some((t) => /1,999|3,999|7,999/.test(t)), pdfText.join(' | '));
      assert.ok(pdfText.includes('GST registration in progress'));
    });

    await test('no stored subscription was rewritten: every legacy/old-price row keeps its planPrice', async () => {
      const rows = await Subscription.find({ razorpayOrderId: { $in: ['order_legacy_1m', 'order_legacy_verify', 'order_old_6m', 'order_legacy_exp'] } }).lean();
      assert.deepStrictEqual(rows.map((r) => r.planPrice).sort(), [1499900, 599900, 599900, 599900].sort());
    });
  } finally {
    server.close();
    await new Promise((r) => setTimeout(r, 300)); // let fire-and-forget audit-log writes land

    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
