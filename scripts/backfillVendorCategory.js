// Step 1 of the SEO restructuring project: backfills Vendor.primaryCategory
// onto every pre-existing vendor. All vendors on the platform today are, in
// fact, interior designers (confirmed via the live public vendor API), so
// they all get pointed at the interior-designers ServiceCategory.
//
// Idempotent: only touches vendors where primaryCategory is currently
// unset, so a second run reports 0 updated rather than re-writing anything.
//
// Usage:
//   node scripts/backfillVendorCategory.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Vendor = require('../src/models/Vendor.model');
const ServiceCategory = require('../src/models/ServiceCategory.model');

async function backfill() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const category = await ServiceCategory.findOne({ slug: 'interior-designers' });
  if (!category) {
    throw new Error('interior-designers ServiceCategory not found — run scripts/seedCategoryTaxonomy.js first.');
  }

  const result = await Vendor.updateMany(
    { primaryCategory: null },
    { $set: { primaryCategory: category._id } }
  );

  console.log(`Vendors matched: ${result.matchedCount}`);
  console.log(`Vendors updated: ${result.modifiedCount}`);

  await mongoose.disconnect();
  process.exit(0);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
