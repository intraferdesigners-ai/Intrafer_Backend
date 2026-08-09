const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    // Still a required User ref, unchanged — unlike Review's guest-submitted
    // flow, every valid sender under the vendor/admin-only model (see
    // message.controller.js's resolveParticipant) is still a real logged-in
    // User account, so there's no guest-authorship case to accommodate here.
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // 'user' is never set on a new message anymore — homeowners are no
    // longer a valid participant (see resolveParticipant). Kept in the enum
    // only for Mongoose validation on pre-removal messages that already have
    // it set; those still need to load and display. See the
    // homeowner-removal plan, Phase 0/7.
    senderRole: { type: String, enum: ['user', 'vendor', 'admin'], required: true },
    text: { type: String, required: true, maxlength: 2000 },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageSchema.index({ leadId: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
