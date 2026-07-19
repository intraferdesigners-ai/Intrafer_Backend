const mongoose = require('mongoose');

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, default: '' },
  },
  { _id: false }
);

const leadSchema = new mongoose.Schema(
  {
    enquiryId: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    projectType: { type: String, default: '' },
    budget: { type: String, default: '' },
    city: { type: String, required: true },
    requirements: { type: String, default: '' },
    status: {
      type: String,
      enum: ['new', 'accepted', 'contacted', 'quotation_sent', 'won', 'lost', 'cancelled'],
      default: 'new',
    },
    contactRevealedAt: { type: Date },
    statusHistory: [statusHistorySchema],
    vendorNotes: { type: String, default: '' },
    isConsultation: { type: Boolean, default: false },
    preferredDate: { type: String, default: '' },
    confirmedDateTime: { type: Date, default: null },
  },
  { timestamps: true }
);

leadSchema.index({ vendorId: 1, status: 1 });
leadSchema.index({ userId: 1 });

module.exports = mongoose.model('Lead', leadSchema);
