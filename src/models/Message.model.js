const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['user', 'vendor'], required: true },
    text: { type: String, required: true, maxlength: 2000 },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageSchema.index({ leadId: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
