const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Settings = require('../src/models/Settings.model');

// One-off fix: a Settings document persisted from earlier CMS testing was
// still holding the pre-rewrite hero subtitle, overriding the updated
// default in SETTINGS_DEFAULTS (admin.controller.js) / DEFAULT_HERO_SUBTITLE
// (public.controller.js). This brings the persisted value back in sync.
const NEW_VALUE = "Compare vetted interior designers by city, style, and budget. Every portfolio shown is real, completed work — submit one enquiry and hear back within two days.";

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const doc = await Settings.findOneAndUpdate(
    { key: 'homepage_hero_subtitle' },
    { value: NEW_VALUE },
    { upsert: true, returnDocument: 'after' }
  );

  console.log('homepage_hero_subtitle now set to:');
  console.log(doc.value);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('Fix failed:', err);
  process.exit(1);
});
