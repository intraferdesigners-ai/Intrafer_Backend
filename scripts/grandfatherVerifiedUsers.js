const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User.model');

// login() now refuses to sign in any account with isEmailVerified: false —
// accounts created through register() start unverified and must complete
// the new OTP step before they can log in (see auth.controller.js). Every
// account that already existed before this shipped predates that OTP step
// entirely and has no way to retroactively complete it, so it must be
// marked verified here, or it loses the ability to log in the moment this
// deploys. Same pattern as grandfatherSuperAdmin.js for the isSuperAdmin
// rollout — run once at/before deploy time.
async function grandfather() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const result = await User.updateMany(
    { $or: [{ isEmailVerified: false }, { isPhoneVerified: false }] },
    { $set: { isEmailVerified: true, isPhoneVerified: true } }
  );

  console.log(`Grandfathered ${result.modifiedCount} pre-existing account(s) as verified.`);

  await mongoose.disconnect();
  process.exit(0);
}

grandfather().catch((err) => {
  console.error('Grandfathering failed:', err);
  process.exit(1);
});
