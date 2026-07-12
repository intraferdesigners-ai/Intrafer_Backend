const mongoose = require('mongoose');

const visitorSchema = new mongoose.Schema({
  sessionId:  { type: String, required: true, index: true },
  name:       { type: String, default: '' },
  contact:    { type: String, default: '' },
  contactType:{ type: String, enum: ['phone', 'email', ''], default: '' },
  city:       { type: String, default: '' },
  source:     { type: String, default: 'popup' },
  isIdentified: { type: Boolean, default: false },
  vendorInterests: [{
    vendorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
    vendorName: { type: String },
    clickCount: { type: Number, default: 1 },
    firstClick: { type: Date, default: Date.now },
    lastClick:  { type: Date, default: Date.now },
    source:     { type: String, enum: ['card', 'profile'], default: 'card' },
  }],
  pageViews:  { type: Number, default: 1 },
  utmSource:  { type: String, default: '' },
  userAgent:  { type: String, default: '' },
}, { timestamps: true });

visitorSchema.index({ sessionId: 1, createdAt: -1 });

module.exports = mongoose.model('Visitor', visitorSchema);
