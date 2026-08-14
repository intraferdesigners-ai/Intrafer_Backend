const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User.model');

// User.phone went from required+unique to sparse+unique to allow Google
// signups (which have no phone number until onboarding) to coexist without
// colliding on the old index's single allowed `null` value (see
// User.model.js and the Google OAuth Enablement plan, §05). Mongoose's
// autoIndex only creates indexes that don't already exist by name — it
// won't rewrite an existing `phone_1` index's options, so the old
// non-sparse unique index has to be dropped explicitly before Mongoose can
// recreate it as sparse. Run once at/before deploy time, same pattern as
// grandfatherVerifiedUsers.js.
async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const collection = mongoose.connection.db.collection('users');
  const existing = await collection.indexes();
  const phoneIndex = existing.find((idx) => idx.name === 'phone_1');

  if (!phoneIndex) {
    console.log('No phone_1 index found — nothing to drop.');
  } else if (phoneIndex.sparse) {
    console.log('phone_1 index is already sparse — nothing to do.');
  } else {
    await collection.dropIndex('phone_1');
    console.log('Dropped non-sparse phone_1 index.');
  }

  // Recreates it (sparse: true, unique: true) per the current schema.
  await User.syncIndexes();
  console.log('Synced indexes to match the current schema.');

  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Phone index migration failed:', err);
  process.exit(1);
});
