const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User.model');
const { PERMISSION_KEYS } = require('../src/constants/permissions');

// The existing seeded admin account (see scripts/createAdmin.js). Roles &
// Permissions ships with every admin route now gated behind requirePermission,
// so this account MUST be marked super admin before/at deploy time, or it
// loses access to its own platform the moment this ships.
const ADMIN_EMAIL = 'admin@intrafer.com';

async function grandfather() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const admin = await User.findOne({ email: ADMIN_EMAIL, role: 'admin' });
  if (!admin) {
    console.log(`No admin user found with email ${ADMIN_EMAIL} — nothing to grandfather.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  admin.isSuperAdmin = true;
  admin.adminPermissions = [...PERMISSION_KEYS];
  await admin.save({ validateBeforeSave: false });

  console.log(`Grandfathered super admin: ${admin.email} (${admin._id.toString()})`);
  console.log(`isSuperAdmin: ${admin.isSuperAdmin}`);
  console.log(`adminPermissions: ${admin.adminPermissions.join(', ')}`);

  await mongoose.disconnect();
  process.exit(0);
}

grandfather().catch((err) => {
  console.error('Grandfathering failed:', err);
  process.exit(1);
});
