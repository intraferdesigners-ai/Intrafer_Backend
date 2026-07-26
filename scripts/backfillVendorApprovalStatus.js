// One-off migration: backfill the new tri-state Vendor.approvalStatus field
// from the existing isApproved/rejectionReason data, for every vendor that
// existed before this field was introduced.
require('dotenv').config();
const mongoose = require('mongoose');
const Vendor = require('../src/models/Vendor.model');

const backfill = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const vendors = await Vendor.find({});
  const counts = { approved: 0, rejected: 0, pending: 0 };

  for (const vendor of vendors) {
    let status;
    if (vendor.isApproved) {
      status = 'approved';
    } else if (vendor.rejectionReason && vendor.rejectionReason.trim()) {
      status = 'rejected';
    } else {
      status = 'pending';
    }
    counts[status] += 1;
    vendor.approvalStatus = status;
    await vendor.save();
  }

  console.log(`Backfilled ${vendors.length} vendors:`);
  console.log(`  approved: ${counts.approved}`);
  console.log(`  rejected: ${counts.rejected}`);
  console.log(`  pending:  ${counts.pending}`);

  await mongoose.disconnect();
  process.exit(0);
};

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
