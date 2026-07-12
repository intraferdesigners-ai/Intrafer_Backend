require('dotenv').config();
const mongoose = require('mongoose');
const Vendor = require('../src/models/Vendor.model');

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const vendor = await Vendor.findOneAndUpdate(
    { businessName: 'Priya Design Studio' },
    { isListingEnabled: true },
    { new: true }
  );

  if (!vendor) {
    console.log('Vendor not found.');
    process.exit(1);
  }

  console.log('Updated vendor:', vendor._id.toString(), '| isListingEnabled:', vendor.isListingEnabled);
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => { console.error(err); process.exit(1); });
