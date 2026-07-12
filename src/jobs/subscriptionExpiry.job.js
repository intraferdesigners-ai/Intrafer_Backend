const cron = require('node-cron');
const Subscription = require('../models/Subscription.model');
const Vendor = require('../models/Vendor.model');

const startJobs = () => {
  cron.schedule(
    '0 0 * * *',
    async () => {
      try {
        const expired = await Subscription.find({
          status: 'active',
          endDate: { $lt: new Date() },
        });

        for (const sub of expired) {
          sub.status = 'expired';
          await sub.save();
          await Vendor.findByIdAndUpdate(sub.vendorId, { isListingEnabled: false });
        }

        console.log(`[CRON] Expired ${expired.length} subscriptions`);
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
          console.log(
            `[CRON] Reminder: vendor ${sub.vendorId} subscription expires ${sub.endDate}`
          );
        }
      } catch (err) {
        console.error(`[CRON] Reminder job error: ${err.message}`);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );

  console.log('[CRON] Subscription jobs scheduled');
};

module.exports = { startJobs };
