const cron = require('node-cron');
const Vendor = require('../models/Vendor.model');
const notifService = require('../services/notification.service');

// A vendor who filled out their profile in one sitting and is still
// deciding whether to subscribe a day or two later is normal — nudging
// then would be premature and naggy. By day 4 that gap reliably reads as
// "stalled" rather than "still deciding", while still being soon enough
// to re-engage before they forget about the platform entirely.
const STALLED_THRESHOLD_DAYS = 4;

const startJobs = () => {
  cron.schedule(
    '0 10 * * *',
    async () => {
      try {
        const cutoff = new Date(Date.now() - STALLED_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

        // Mirrors OnboardingChecklist.jsx's own "profile complete" definition
        // exactly, so this only fires for vendors the app itself already
        // shows as done with step 1.
        const stalled = await Vendor.find({
          isListingEnabled: false,
          onboardingNudgeSentAt: null,
          createdAt: { $lte: cutoff },
          businessName: { $ne: '' },
          description: { $ne: '' },
          'location.city': { $ne: '' },
          'specializations.0': { $exists: true },
        }).populate('userId', 'name email emailNotifications notificationPreferences');

        let sent = 0;
        for (const vendor of stalled) {
          if (!vendor.userId) continue;
          notifService.dispatch('ONBOARDING_STALLED', { vendor, user: vendor.userId });
          vendor.onboardingNudgeSentAt = new Date();
          await vendor.save();
          sent += 1;
        }

        console.log(`[CRON] Sent onboarding-stalled nudge to ${sent} vendor(s)`);
      } catch (err) {
        console.error(`[CRON] Onboarding nudge job error: ${err.message}`);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );

  console.log('[CRON] Onboarding nudge job scheduled');
};

module.exports = { startJobs };
