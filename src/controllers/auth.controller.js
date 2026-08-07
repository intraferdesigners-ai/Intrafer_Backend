const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User.model');
const Vendor = require('../models/Vendor.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const otpService = require('../services/otp.service');
const emailService = require('../services/email.service');
const notifService = require('../services/notification.service');

const signAccessToken = (id) =>
  jwt.sign({ id }, process.env.JWT_ACCESS_SECRET, { expiresIn: process.env.JWT_ACCESS_EXPIRES });

const signRefreshToken = (id) =>
  jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES });

// sameSite: 'lax', not 'strict' — this cookie is what POST /auth/refresh
// relies on for every silent token refresh. Strict cookies are withheld by
// the browser on the first request after a top-level cross-site redirect
// back into the app (e.g. returning from a Razorpay netbanking/UPI bank
// page), which made refresh fail as if the session were dead and forced a
// logout mid-payment even though nothing was actually wrong. Lax still
// withholds the cookie on cross-site POSTs, which is what actually matters
// for CSRF protection on this state-changing endpoint.
const setRefreshCookie = (res, token) =>
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

// Sends (or resends) an OTP to a user's email, shared by register() and
// sendOTP() so there's exactly one place that pairs otpService.createAndSaveOTP
// with the email dispatch.
const sendOtpToUser = async (user) => {
  const otp = await otpService.createAndSaveOTP(user._id);
  emailService.sendOTPEmail({ to: user.email, name: user.name, otp }).catch((err) =>
    console.error('[OTP] Email send failed:', err.message)
  );
};

const register = catchAsync(async (req, res) => {
  const { name, email, phone, password } = req.body;
  // `role` is never trusted verbatim from the client, no matter what
  // registerRules' body('role').isIn(['user','vendor']) already enforces
  // upstream — that validator is one layer that could someday be loosened
  // or bypassed by a route that reuses this controller without it. Clamped
  // to exactly these two values here too, so register() can never create an
  // admin account under any circumstance. Real admin accounts only ever
  // come from scripts/createAdmin.js or an authenticated super admin via
  // POST /api/admin/admin-users (see admin.routes.js's isSuperAdmin gate).
  const role = req.body.role === 'vendor' ? 'vendor' : 'user';

  const existing = await User.findOne({ $or: [{ email }, { phone }] });
  if (existing) return error(res, 'Email or phone already registered.', 409);

  const user = await User.create({ name, email, phone, passwordHash: password, role });

  if (role === 'vendor') {
    await Vendor.create({ userId: user._id, businessName: name });
    // The VENDOR_REGISTERED welcome notification/email fires from
    // verifyOTP() instead, once the account is actually activated — sending
    // it here would welcome an email address that hasn't been confirmed yet.
  }

  await sendOtpToUser(user);

  return success(res, { userId: user._id, name: user.name, email: user.email, role: user.role },
    'Almost there — enter the verification code we just emailed you.', 201);
});

const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  const passwordMatch = user ? await user.comparePassword(password) : false;
  if (!user || !passwordMatch) return error(res, 'Invalid email or password.', 401);

  // Accounts from register() start unverified and must complete the OTP step
  // there before they can log in (see register()/verifyOTP()). Admin accounts
  // (scripts/createAdmin.js, POST /api/admin/admin-users) are always created
  // pre-verified, and scripts/grandfatherVerifiedUsers.js marks every account
  // that existed before this gate shipped as verified too, so this only ever
  // blocks a genuinely-incomplete new signup.
  if (!user.isEmailVerified) {
    return error(res,
      'Please verify your email before logging in. Check your inbox for the verification code, or request a new one.',
      403);
  }

  const accessToken = signAccessToken(user._id);
  const refreshToken = signRefreshToken(user._id);

  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  setRefreshCookie(res, refreshToken);

  const userPayload = { id: user._id, name: user.name, email: user.email, role: user.role };
  userPayload.emailNotifications = user.emailNotifications;
  if (user.role === 'admin') {
    userPayload.isSuperAdmin = user.isSuperAdmin;
    userPayload.adminPermissions = user.adminPermissions;
  }

  return success(res, {
    accessToken,
    user: userPayload,
  });
});

const sendOTP = catchAsync(async (req, res) => {
  const { email, phone, name } = req.body;

  let user = await User.findOne({ $or: [{ email }, { phone }] });
  if (!user) {
    user = await User.create({
      name,
      email,
      phone,
      passwordHash: `PENDING_${Date.now()}`,
      role: 'user',
    });
  }

  await sendOtpToUser(user);

  return success(res, { userId: user._id, role: user.role }, 'OTP sent to your email.');
});

const verifyOTP = catchAsync(async (req, res) => {
  const { userId, otp } = req.body;

  // Read before verifying so the vendor-welcome notification below can tell
  // a first-time activation from a redundant re-verify of an already-active
  // account (e.g. someone hits /send-otp again after already being verified)
  // — otherwise it could re-fire the welcome email on every re-verification.
  const wasAlreadyVerified = (await User.findById(userId).select('isEmailVerified'))?.isEmailVerified;

  const result = await otpService.verifyOTP(userId, otp);
  if (!result.valid) return error(res, result.message, 400);

  const user = await User.findById(userId);

  if (!wasAlreadyVerified && user.role === 'vendor') {
    const vendor = await Vendor.findOne({ userId: user._id });
    if (vendor) notifService.dispatch('VENDOR_REGISTERED', { vendor, user });
  }

  const accessToken = signAccessToken(user._id);

  return success(res, {
    accessToken,
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
  });
});

const refreshToken = catchAsync(async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return error(res, 'No refresh token provided.', 401);

  const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  const user = await User.findById(decoded.id);

  if (!user || user.refreshToken !== token) return error(res, 'Invalid refresh token.', 401);

  const accessToken = signAccessToken(user._id);
  // `role` rides along so the frontend can re-sync its intrafer_role cookie
  // on every silent refresh — that cookie is otherwise only ever written at
  // login, so without this a long-lived session's role cookie can go stale
  // or expire independently of the access token, leaving middleware.js (which
  // trusts only the cookie) and the client's auth store (which can re-derive
  // role from /auth/me using nothing but the access token) disagreeing about
  // whether the user is still authenticated.
  return success(res, { accessToken, role: user.role });
});

const logout = catchAsync(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: '' } });
  res.clearCookie('refreshToken');
  return success(res, {}, 'Logged out successfully.');
});

const getMe = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).select('-passwordHash -refreshToken');
  if (!user) return error(res, 'User not found.', 404);

  const userPayload = { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role };
  userPayload.emailNotifications = user.emailNotifications;
  if (user.role === 'admin') {
    userPayload.isSuperAdmin = user.isSuperAdmin;
    userPayload.adminPermissions = user.adminPermissions;
  }

  return success(res, { user: userPayload });
});

const updateProfile = catchAsync(async (req, res) => {
  const { name, phone, emailNotifications } = req.body;

  // name/phone stay optional here (rather than name being required) so a
  // partial payload — e.g. the Settings page's { emailNotifications } toggle,
  // which doesn't resend name/phone — doesn't get rejected. When name IS
  // sent, it still can't be blanked out.
  const updates = {};
  if (name !== undefined) {
    if (!name.trim()) return error(res, 'Name is required.', 400);
    updates.name = name.trim();
  }
  if (phone) updates.phone = phone.trim();
  if (emailNotifications !== undefined) updates.emailNotifications = Boolean(emailNotifications);

  const user = await User.findByIdAndUpdate(
    req.user._id,
    updates,
    { new: true, runValidators: true }
  ).select('-passwordHash -refreshToken');

  return success(res, {
    user: {
      id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role,
      emailNotifications: user.emailNotifications,
    },
  }, 'Profile updated.');
});

const NOTIFICATION_EVENT_KEYS = ['leadAssigned', 'leadAccepted', 'paymentSuccess'];
const NOTIFICATION_CHANNELS = ['email', 'whatsapp'];

const updateNotificationPreferences = catchAsync(async (req, res) => {
  const updates = req.body || {};
  const setObj = {};

  // Only $set the specific leaf paths present in the request body, so
  // event keys/channels not included are left completely untouched —
  // a true partial merge rather than an overwrite.
  for (const eventKey of NOTIFICATION_EVENT_KEYS) {
    const eventUpdates = updates[eventKey];
    if (!eventUpdates || typeof eventUpdates !== 'object') continue;
    for (const channel of NOTIFICATION_CHANNELS) {
      if (eventUpdates[channel] !== undefined) {
        setObj[`notificationPreferences.${eventKey}.${channel}`] = Boolean(eventUpdates[channel]);
      }
    }
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: setObj },
    { new: true, runValidators: true }
  ).select('notificationPreferences');

  if (!user) return error(res, 'User not found.', 404);

  return success(res, { notificationPreferences: user.notificationPreferences }, 'Notification preferences updated.');
});

// Matches the minimum enforced by registerRules/resetPasswordRules in
// validators/auth.validator.js — keep in sync with that file.
const MIN_PASSWORD_LENGTH = 8;

const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return error(res, 'Current password and new password are required.', 400);
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return error(res, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
  }

  const user = await User.findById(req.user._id);
  const passwordMatch = await user.comparePassword(currentPassword);
  if (!passwordMatch) return error(res, 'Current password is incorrect.', 401);

  user.passwordHash = newPassword;
  await user.save();

  return success(res, {}, 'Password changed successfully.');
});

const RESET_TOKEN_EXPIRY_MINUTES = 30;

const forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email: email?.toLowerCase() });
  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    user.passwordResetToken = hashedToken;
    user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.CLIENT_URL}/auth/reset-password?token=${rawToken}`;
    emailService.sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl }).catch((err) =>
      console.error('[ForgotPassword] Email send failed:', err.message)
    );
  }

  // Always return success — don't reveal whether the email is registered
  return success(res, {}, 'If this email is registered, you will receive a reset link shortly.');
});

const resetPassword = catchAsync(async (req, res) => {
  const { token, password } = req.body;
  if (!token) return error(res, 'Reset token is required.', 400);

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: new Date() },
  }).select('+passwordResetToken +passwordResetExpires');

  if (!user) return error(res, 'This reset link is invalid or has expired. Please request a new one.', 400);

  user.passwordHash = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.refreshToken = undefined; // force re-login on all devices
  await user.save();

  return success(res, {}, 'Password reset successfully. Please sign in with your new password.');
});

const SAVED_VENDOR_FIELDS = 'businessName location specializations portfolioImages bannerImage profilePhoto rating reviewCount isApproved isFeatured';

const getSavedVendors = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).populate('savedVendors', SAVED_VENDOR_FIELDS);
  return success(res, { vendors: user.savedVendors });
});

const saveVendor = catchAsync(async (req, res) => {
  const { vendorId } = req.params;
  await User.findByIdAndUpdate(req.user._id, { $addToSet: { savedVendors: vendorId } });
  return success(res, {}, 'Vendor saved.');
});

const unsaveVendor = catchAsync(async (req, res) => {
  const { vendorId } = req.params;
  await User.findByIdAndUpdate(req.user._id, { $pull: { savedVendors: vendorId } });
  return success(res, {}, 'Vendor removed from saved list.');
});

module.exports = {
  register, login, sendOTP, verifyOTP, refreshToken, logout, getMe, updateProfile, changePassword,
  forgotPassword, resetPassword, getSavedVendors, saveVendor, unsaveVendor, updateNotificationPreferences,
};
