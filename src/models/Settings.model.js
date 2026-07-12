const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed },
    label: { type: String },
    group: { type: String, default: 'general' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Settings', settingsSchema);
