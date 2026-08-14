const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User.model');
const Vendor = require('../models/Vendor.model');
const AuditLog = require('../models/AuditLog.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const otpService = require('../services/otp.service');
const emailService = require('../services/email.service');
const notifService = require('../services/notification.service');
const { isBot } = require('../utils/honeypot');

// Google Identity Services ID-token flow — the client posts a signed
// credential it got directly from Google, and this verifies it server-side
// against our own client ID. No client secret, no callback route (see the
// Google OAuth Enablement plan, §02).
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// A same-shaped fake id for a honeypot-triggered "success" response below —
// looks like a real Mongo ObjectId (24 hex chars) without touching the
// database, since nothing was actually created for a caller that tripped
// the honeypot.
const fakeObjectId = () => crypto.randomBytes(12).toString('hex');

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

  // Honeypot tripped — respond exactly like a real, successful registration
  // (same shape, same message, same 201) without creating any account or
  // sending any OTP, so a bot's script sees nothing to indicate it was
  // caught. See src/utils/honeypot.js.
  if (isBot(req)) {
    return success(res, { userId: fakeObjectId(), name, email, role: 'vendor' },
      'Almost there — enter the verification code we just emailed you.', 201);
  }

  // `role` is never read from the client at all, let alone trusted — the
  // homeowner role has no self-registration surface anymore (see the
  // homeowner-removal plan, Phase 4/5) and register() can never create an
  // admin account under any circumstance, so this is unconditionally the
  // only value it can produce. Real admin accounts only ever come from
  // scripts/createAdmin.js or an authenticated super admin via POST
  // /api/admin/admin-users (see admin.routes.js's isSuperAdmin gate).
  const role = 'vendor';

  const existing = await User.findOne({ $or: [{ email }, { phone }] });
  if (existing) return error(res, 'Email or phone already registered.', 409);

  const user = await User.create({ name, email, phone, passwordHash: password, role });

  await Vendor.create({ userId: user._id, businessName: name });
  // The VENDOR_REGISTERED welcome notification/email fires from verifyOTP()
  // instead, once the account is actually activated — sending it here would
  // welcome an email address that hasn't been confirmed yet.

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

// Single endpoint for both Google signup and Google sign-in — `intent` is a
// UX branch only, never a security boundary (see below). Vendor accounts
// only: this can never create, link, or authenticate an admin account (§04
// of the plan), enforced as a role check here in the backend itself, not by
// hiding a button in the UI — a direct/forged API call hits the identical
// check.
const googleAuth = catchAsync(async (req, res) => {
  const { credential, intent } = req.body;

  if (!process.env.GOOGLE_CLIENT_ID) {
    return error(res, 'Google sign-in is not configured.', 503);
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    return error(res, 'Invalid or expired Google credential.', 401);
  }

  // An unverified Google email can't prove account ownership — reject
  // before it's ever used to look up or create anything.
  if (!payload?.email_verified) {
    return error(res, 'Your Google email is not verified.', 401);
  }

  const email = payload.email.toLowerCase();
  const googleId = payload.sub;

  let user = await User.findOne({ email });

  // Admin lockdown. Runs immediately after the lookup and before any
  // create/link/token logic, reading `role` on the matched account — not
  // any client-supplied field, so no value of `credential` or `intent` can
  // route around it. A generic message, not "this email is an admin", so
  // the response itself doesn't leak whether the email belongs to an admin.
  if (user?.role === 'admin') {
    // Fire-and-forget, same convention as middleware/auditLog.js (never
    // delays or can fail the response). Reused rather than that middleware
    // itself — it's wired for an *authenticated admin's own* action
    // (requires req.user, and explicitly skips on statusCode >= 400), the
    // opposite of what's true here: an anonymous caller, rejected. `adminId`
    // etc. identify the account that was targeted, not who performed the
    // request — see the one-line clarification on the audit-logs page.
    AuditLog.create({
      adminId: user._id,
      adminName: user.name,
      adminEmail: user.email,
      action: 'Rejected Google sign-in attempt (admin lockdown)',
      method: req.method,
      path: req.originalUrl,
      statusCode: 403,
      ip: req.ip,
    }).catch((err) => console.error('Audit log failed:', err));

    return error(res, 'This account uses password sign-in.', 403);
  }

  let isNewUser = false;

  if (user) {
    // Matched by verified email — sign-in, and link this Google identity if
    // it isn't already. No password is touched or required; Google's
    // email_verified claim is treated as equivalent proof of ownership to
    // our own OTP round-trip, so this also activates an account that
    // registered by password but never finished OTP verification.
    // Captured before mutating — only a password-based account that didn't
    // already have a googleId is a genuine new link worth notifying about.
    // A Google-native account (no passwordHash) has nothing to "link" here;
    // it just signs in again.
    const justLinked = !user.googleId && !!user.passwordHash;

    let dirty = false;
    if (!user.googleId) { user.googleId = googleId; dirty = true; }
    if (!user.isEmailVerified) { user.isEmailVerified = true; dirty = true; }
    if (dirty) await user.save({ validateBeforeSave: false });

    if (justLinked) {
      const linkedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
      emailService.sendGoogleAccountLinkedEmail({ to: user.email, name: user.name, linkedAt }).catch((err) =>
        console.error('[GoogleAuth] Linked-account email failed:', err.message)
      );
    }
  } else {
    // No account for this email. `intent` decides the UX, not whether an
    // account gets created — but on the login page specifically (intent:
    // 'login'), we do not silently provision one; a distinct NO_ACCOUNT
    // response lets the frontend show "no account found, sign up instead"
    // instead of a login click quietly becoming a signup (§03).
    if (intent !== 'signup') {
      return error(res, 'No account found for this email. Please sign up instead.', 404, { code: 'NO_ACCOUNT' });
    }

    // `role` is hardcoded here, never read from the token or the request
    // body — identical pattern to register()'s `const role = 'vendor'`.
    // Even a forged `intent: 'signup'` can only ever produce a vendor
    // account. `phone` is intentionally omitted — Google doesn't supply
    // one; it's collected afterward during onboarding (User.model.js's
    // `phone` is sparse, not required, for exactly this case).
    user = await User.create({
      name: payload.name || payload.email.split('@')[0],
      email,
      googleId,
      isEmailVerified: true,
      role: 'vendor',
    });
    await Vendor.create({ userId: user._id, businessName: user.name });
    isNewUser = true;
  }

  if (isNewUser) {
    const vendor = await Vendor.findOne({ userId: user._id });
    if (vendor) notifService.dispatch('VENDOR_REGISTERED', { vendor, user });
  }

  const accessToken = signAccessToken(user._id);
  const refreshTokenValue = signRefreshToken(user._id);
  user.refreshToken = refreshTokenValue;
  await user.save({ validateBeforeSave: false });
  setRefreshCookie(res, refreshTokenValue);

  const userPayload = { id: user._id, name: user.name, email: user.email, role: user.role };
  userPayload.emailNotifications = user.emailNotifications;

  return success(res, { accessToken, user: userPayload, isNewUser },
    isNewUser ? 'Account created.' : 'Signed in.');
});

// Only reachable today via a resend — vendor registration's own OTP-verify
// step (auth/register/verify/page.jsx) and the login page's "resend
// verification" action for an account that registered but never completed
// it (see login()'s 403 branch below). Both always operate on an email that
// register() already created a User for, so this never needs to create one
// itself; the guest-enquiry OTP path (which used to reach this same
// endpoint and did need to auto-create an account) has its own separate,
// User-free flow now — see enquiry.controller.js and the homeowner-removal
// plan, Phases 2-7.
const sendOTP = catchAsync(async (req, res) => {
  const { email, phone } = req.body;

  // Honeypot tripped — fake success, no OTP sent. See src/utils/honeypot.js.
  if (isBot(req)) {
    return success(res, { userId: fakeObjectId(), role: 'vendor' }, 'OTP sent to your email.');
  }

  const user = await User.findOne({ $or: [{ email }, { phone }] });
  if (!user) {
    return error(res, 'No account found for this email. Please register first.', 404);
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
  // Unlike login(), this path used to hand back an access token with no
  // refresh token at all — every account activated via OTP (fresh signup, or
  // the login page's "Email code" tab) would silently lose its session the
  // moment that access token expired (JWT_ACCESS_EXPIRES), since the client's
  // refresh interceptor had no refreshToken cookie to call /auth/refresh
  // with and hard-redirected to login. Issuing and storing one here too puts
  // this path in lockstep with login()'s session lifetime.
  const refreshTokenValue = signRefreshToken(user._id);
  user.refreshToken = refreshTokenValue;
  await user.save({ validateBeforeSave: false });
  setRefreshCookie(res, refreshTokenValue);

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

module.exports = {
  register, login, googleAuth, sendOTP, verifyOTP, refreshToken, logout, getMe, updateProfile, changePassword,
  forgotPassword, resetPassword, updateNotificationPreferences,
};
