// Collapses leads sitting in the retired 'contacted'/'quotation_sent'
// pipeline stages into 'accepted' — the nearest remaining status. Both
// removed statuses already sit in the "contact revealed, in progress"
// bucket alongside 'accepted' (see CONTACT_REVEALED_STATUSES in
// lead.controller.js), so this is a status-label collapse, not a change
// in what the vendor/admin can see for these leads.
//
// Run this BEFORE deploying the enum change in Lead.model.js — once that
// enum drops 'contacted'/'quotation_sent', Mongoose will reject any save
// on a lead still holding one of those values.
//
// Safe to re-run: only touches leads whose status is still one of the two
// removed values, so a second run reports 0 matched.
//
// Usage:
//   node scripts/migrateRemovedLeadStatuses.js --dry-run
//   BACKFILL_MONGODB_URI=<staging-uri> node scripts/migrateRemovedLeadStatuses.js --dry-run
//     (point this at a staging copy first — see backfillLeadContactFields.js for the same convention)
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Lead = require('../src/models/Lead.model');

const DRY_RUN = process.argv.includes('--dry-run');
const MONGO_URI = process.env.BACKFILL_MONGODB_URI || process.env.MONGODB_URI;
const REMOVED_STATUSES = ['contacted', 'quotation_sent'];
const TARGET_STATUS = 'accepted';

async function migrate() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to ${MONGO_URI.replace(/\/\/[^@]+@/, '//***:***@')}`);
  console.log(DRY_RUN ? 'DRY RUN — no writes will be made.' : 'LIVE RUN — leads will be updated.');

  // Bypass the (already-updated-in-code, not-yet-deployed-at-migration-time)
  // schema enum validation — this script's whole job is to move documents
  // OFF values the new enum will reject, so it must be able to read/write
  // them without Mongoose stripping or rejecting the old value first.
  const leads = await mongoose.connection.collection('leads')
    .find({ status: { $in: REMOVED_STATUSES } })
    .project({ _id: 1, enquiryId: 1, status: 1 })
    .toArray();

  console.log(`Found ${leads.length} lead(s) in a removed status.`);

  const byStatus = leads.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {});
  console.log('Breakdown:', byStatus);

  if (leads.length && !DRY_RUN) {
    const now = new Date();
    for (const lead of leads) {
      await mongoose.connection.collection('leads').updateOne(
        { _id: lead._id },
        {
          $set: { status: TARGET_STATUS },
          $push: {
            statusHistory: {
              status: TARGET_STATUS,
              changedAt: now,
              note: `Migrated from '${lead.status}' — status removed from pipeline.`,
            },
          },
        }
      );
    }
  }

  console.log('---');
  console.log(`Total migrated: ${DRY_RUN ? 0 : leads.length} (${leads.length} matched)`);
  if (leads.length) {
    console.log('Sample:', leads.slice(0, 5).map((l) => ({ id: String(l._id), enquiryId: l.enquiryId, from: l.status, to: TARGET_STATUS })));
  }

  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
