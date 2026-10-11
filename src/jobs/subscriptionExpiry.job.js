const cron = require('node-cron');
const Subscription = require('../models/Subscription.model');
const Vendor = require('../models/Vendor.model');
const notifService = require('../services/notification.service');
const cache = require('../utils/revalidate');

// Expires every active subscription past its end date and disables that
// vendor's listing (then purges the vendor from the frontend cache).
// Exported so it can be tested without the cron schedule.
async function expireSubscriptions() {
  const expired = await Subscription.find({
    status: 'active',
    endDate: { $lt: new Date() },
  });

  for (const sub of expired) {
    sub.status = 'expired';
    await sub.save();
    await Vendor.findByIdAndUpdate(sub.vendorId, { isListingEnabled: false });
    cache.purgeVendor(sub.vendorId);
  }
  return expired.length;
}

const startJobs = () => {
  cron.schedule(
    '0 0 * * *',
    async () => {
      try {
        const count = await expireSubscriptions();
        console.log(`[CRON] Expired ${count} subscriptions`);
      } catch (err) {
        console.error(`[CRON] Expiry job error: ${err.message}`);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );

  cron.schedule(
    '0 9 * * *',
    async () => {
      try {
        const now = new Date();
        const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

        const expiringSoon = await Subscription.find({
          status: 'active',
          endDate: { $gte: now, $lte: in3Days },
        }).populate({
          path: 'vendorId',
          populate: { path: 'userId', select: 'email phone' },
        });

        for (const sub of expiringSoon) {
          if (!sub.vendorId || !sub.vendorId.userId) continue;
          notifService.dispatch('SUBSCRIPTION_EXPIRING', {
            vendor: sub.vendorId,
            user: sub.vendorId.userId,
            subscription: sub,
          });
        }
      } catch (err) {
        console.error(`[CRON] Reminder job error: ${err.message}`);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );

  console.log('[CRON] Subscription jobs scheduled');
};

module.exports = { startJobs, expireSubscriptions };
