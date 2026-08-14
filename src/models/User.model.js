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
    // sparse (not required) — a Google signup doesn't supply a phone number;
    // it's collected afterward during onboarding instead (see
    // auth.controller.js's googleAuth()). Still unique whenever it IS set,
    // since register() still requires it up front for password signups.
    phone: { type: String, unique: true, trim: true, sparse: true },
    // Conditionally required — a Google-only account (no linked password)
    // has nothing to hash. Still required for every password-based account,
    // same as before.
    passwordHash: { type: String, required: function () { return !this.googleId; } },
    // Link key for Google Identity Services sign-in — set on first Google
    // auth, whether that's a brand-new account or linking an existing
    // password account by verified email (see googleAuth() in
    // auth.controller.js). Kept as its own field rather than a single
    // authProvider enum so a vendor can hold both a password AND a linked
    // Google identity at once, rather than the two being mutually exclusive.
    googleId: { type: String, unique: true, sparse: true },
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
