// One-off migration for the subscription-is-the-only-gate change: isApproved
// (Vendor) and moderationStatus (Project) now default to approved going
// forward — new documents pick that up automatically — but existing
// documents created under the old defaults don't get touched retroactively,
// so this backfills them once.
//
// Three groups, run once against production on 2026-07-31:
//   1. Vendors with isApproved: false and no real rejection on record
//      (approvalStatus !== 'rejected') -> isApproved: true, approved.
//      Ran against 20 vendors, 7 matched.
//   2. Projects with moderationStatus literally 'pending' -> approved.
//      Ran against 34 projects, 14 matched.
//   3. Projects with NO moderationStatus field stored at all (legacy docs
//      that predate the field, same root cause as
//      backfillVendorApprovalStatus.js) -> approved. These never matched
//      any public query filter regardless of schema default, so they were
//      invisible on the live site independent of this change. 16 matched.
// Final state after running: 20/20 vendors approved, 34/34 projects
// resolved (32 approved + 2 real historical rejections left untouched).
//
// Safe to re-run — each group's filter naturally matches nothing once
// backfilled.
require('dotenv').config();
const mongoose = require('mongoose');
const Vendor = require('../src/models/Vendor.model');
const Project = require('../src/models/Project.model');

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const vendorRes = await Vendor.updateMany(
    { isApproved: false, approvalStatus: { $ne: 'rejected' } },
    { $set: { isApproved: true, approvalStatus: 'approved', reviewedAt: new Date() } }
  );
  console.log('Vendors backfilled (isApproved false -> true):', vendorRes.modifiedCount);

  const pendingRes = await Project.updateMany(
    { moderationStatus: 'pending' },
    { $set: { moderationStatus: 'approved' } }
  );
  console.log('Projects backfilled (moderationStatus pending -> approved):', pendingRes.modifiedCount);

  const legacyRes = await mongoose.connection.db.collection('projects').updateMany(
    { moderationStatus: { $exists: false } },
    { $set: { moderationStatus: 'approved', rejectionReason: '' } }
  );
  console.log('Legacy projects backfilled (missing field -> approved):', legacyRes.modifiedCount);

  const remainingUnapprovedVendors = await Vendor.countDocuments({ isApproved: false });
  const remainingUnresolvedProjects = await Project.countDocuments({ moderationStatus: { $exists: false } });
  console.log('Remaining isApproved:false vendors (real rejections, expected > 0 is fine):', remainingUnapprovedVendors);
  console.log('Remaining projects with no moderationStatus (should be 0):', remainingUnresolvedProjects);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
