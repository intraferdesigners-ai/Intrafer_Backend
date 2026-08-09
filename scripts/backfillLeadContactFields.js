// Phase 1 of homeowner-role removal: copies each Lead's enquirer
// name/email/phone off the User it references onto flat fields living
// directly on the Lead, so vendor/admin lead views stop depending on
// User being populated. Lead.userId itself is left untouched — this is
// additive, not a cutover (see the homeowner-removal plan, Phase 1).
//
// Safe to re-run: every lead is unconditionally re-synced from its
// current userId, so a second run reports the same leads as "already
// up to date" rather than duplicating or corrupting anything.
//
// Usage:
//   node scripts/backfillLeadContactFields.js [--dry-run]
//   BACKFILL_MONGODB_URI=<uri> node scripts/backfillLeadContactFields.js
//     (overrides MONGODB_URI from .env — used to point this at a staging copy)
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Lead = require('../src/models/Lead.model');
const User = require('../src/models/User.model');

const DRY_RUN = process.argv.includes('--dry-run');
const MONGO_URI = process.env.BACKFILL_MONGODB_URI || process.env.MONGODB_URI;

async function backfill() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to ${MONGO_URI.replace(/\/\/[^@]+@/, '//***:***@')}`);
  console.log(DRY_RUN ? 'DRY RUN — no writes will be made.' : 'LIVE RUN — leads will be updated.');

  const leads = await Lead.find({}).select('_id enquiryId userId contactName contactEmail contactPhone');
  console.log(`Found ${leads.length} lead(s) total.`);

  let updated = 0;
  let unchanged = 0;
  let orphaned = 0;
  const sample = [];

  for (const lead of leads) {
    const user = await User.findById(lead.userId).select('name email phone').lean();
    if (!user) {
      orphaned += 1;
      console.warn(`  Lead ${lead._id} (${lead.enquiryId || ''}) has no matching User for userId ${lead.userId} — leaving contact fields untouched.`);
      continue;
    }

    const target = {
      contactName: user.name || '',
      contactEmail: user.email || '',
      contactPhone: user.phone || '',
    };
    const needsUpdate =
      lead.contactName !== target.contactName ||
      lead.contactEmail !== target.contactEmail ||
      lead.contactPhone !== target.contactPhone;

    if (!needsUpdate) {
      unchanged += 1;
      continue;
    }

    updated += 1;
    if (sample.length < 5) {
      sample.push({ leadId: String(lead._id), enquiryId: lead.enquiryId, ...target });
    }
    if (!DRY_RUN) {
      await Lead.updateOne({ _id: lead._id }, { $set: target });
    }
  }

  console.log('---');
  console.log(`Total leads:        ${leads.length}`);
  console.log(`Updated:            ${updated}`);
  console.log(`Already up to date: ${unchanged}`);
  console.log(`Orphaned (no User): ${orphaned}`);
  if (sample.length) {
    console.log('Sample of updated leads:');
    console.log(JSON.stringify(sample, null, 2));
  }

  await mongoose.disconnect();
  process.exit(0);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
