const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// role: 'user' is the old homeowner account role. Nothing creates new
// 'user' rows anymore — homeowners now submit enquiries as guests, with
// contact info living directly on Lead (contactName/contactEmail/
// contactPhone) instead of a User account. See the "Removing the
// Homeowner Role" plan (Phases 1-7) for the full removal.
//
// Existing 'user' rows are deliberately left in place, not purged. They're
// still the historical author of pre-removal Review.userId and
// Message.senderId records, so deleting them would blank out or break
// real historical data. This was a conscious decision (Phase 0), not an
// oversight — a future data-retention/purge pass is a separate, deliberate
// call, not something to do as incidental cleanup here. Do not reintroduce
// homeowner account creation (register(), sendOTP(), etc.) as a "fix" for
// this enum value still existing; the enum stays only for these legacy
// rows and for Mongoose validation on documents that already have it set.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['user', 'vendor', 'admin'], default: 'user' },
    isPhoneVerified: { type: Boolean, default: false },
    isEmailVerified: { type: Boolean, default: false },
    otp: {
      code: { type: String },
      expiresAt: { type: Date },
      attempts: { type: Number, default: 0 },
    },
    refreshToken: { type: String },
    isBlocked: { type: Boolean, default: false },
    blockReason: { type: String, default: '' },
    emailNotifications: { type: Boolean, default: true },
    // Per-event channel overrides. Leaves are intentionally left with no
    // `default` — undefined means "not yet set" and falls back to
    // emailNotifications (email) / on (whatsapp) in notification.service.js's
    // shouldSendEmail/shouldSendWhatsapp. Do NOT add `default: true` here:
    // that would silently re-enable notifications on read for anyone who
    // had previously opted out via emailNotifications, without consent.
    notificationPreferences: {
      leadAssigned:         { email: { type: Boolean }, whatsapp: { type: Boolean } },
      leadAccepted:         { email: { type: Boolean }, whatsapp: { type: Boolean } },
      paymentSuccess:       { email: { type: Boolean }, whatsapp: { type: Boolean } },
    },
    // Only meaningful when role === 'admin'.
    isSuperAdmin: { type: Boolean, default: false },
    adminPermissions: { type: [String], default: [] },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.pre('save', async function () {
  if (!this.isModified('passwordHash')) return;
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

module.exports = mongoose.model('User', userSchema);
