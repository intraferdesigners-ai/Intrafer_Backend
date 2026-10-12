// Subscription plans: the ONLY place plan prices live. Prices are in paise
// (Razorpay's unit and Subscription.planPrice's). The frontend reads every
// price it shows from GET /api/subscriptions/plans.
//
// sellable: true  -> offered by GET /plans and accepted by create-order and
//                    check-coupon.
// sellable: false -> legacy. Kept only so subscriptions and orders created
//                    under an old plan name still resolve by NAME (payment
//                    activation via verify/webhook uses durationDays). Legacy
//                    entries carry no price on purpose: what a vendor paid is
//                    the stored Subscription.planPrice, never recomputed from
//                    this table.
//
// Names are stored on Subscription.planName and Coupon.applicablePlans, so a
// name, once sold, must never be removed or reused with a different duration.
// History: 'Basic'/'Pro'/'Premium' (to 2026-07-14), '3 Month' (90 days,
// ₹7,999 then a ₹1 test price, to 2026-09-29), '1 Month'/'6 Month'/'12 Month'
// (2026-09-29 to the current price change).

const PLANS = Object.freeze([
  { name: '3 Month',  displayName: '3 Months',  period: '3 months',  price: 199900, leadsPerMonth: 10, durationDays: 90,  sellable: true },
  { name: '6 Month',  displayName: '6 Months',  period: '6 months',  price: 399900, leadsPerMonth: 10, durationDays: 180, sellable: true },
  { name: '12 Month', displayName: '12 Months', period: '12 months', price: 799900, leadsPerMonth: 10, durationDays: 365, sellable: true },

  // Legacy: no longer sold.
  { name: '1 Month',  displayName: '1 Month',   period: '1 month',   leadsPerMonth: 10, durationDays: 30,  sellable: false },
].map((p) => Object.freeze(p)));

// Any plan, sellable or legacy (activation, admin tooling).
const findPlan = (name) => PLANS.find((p) => p.name === name) || null;

const sellablePlans = () => PLANS.filter((p) => p.sellable);

// What GET /plans exposes.
const publicPlan = ({ name, displayName, period, price, leadsPerMonth, durationDays }) =>
  ({ name, displayName, period, price, leadsPerMonth, durationDays });

module.exports = { PLANS, findPlan, sellablePlans, publicPlan };
