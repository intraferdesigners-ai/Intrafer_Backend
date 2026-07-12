const jwt = require('jsonwebtoken');
const User = require('../models/User.model');
const Vendor = require('../models/Vendor.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const otpService = require('../services/otp.service');
const emailService = require('../services/email.service');

const signAccessToken = (id) =>
  jwt.sign({ id }, process.env.JWT_ACCESS_SECRET, { expiresIn: process.env.JWT_ACCESS_EXPIRES });

const signRefreshToken = (id) =>
  jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES });

const setRefreshCookie = (res, token) =>
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

const register = catchAsync(async (req, res) => {
  const { name, email, phone, password, role } = req.body;

  const existing = await User.findOne({ $or: [{ email }, { phone }] });
  if (existing) return error(res, 'Email or phone already registered.', 409);

  const user = await User.create({ name, email, phone, passwordHash: password, role });

  if (role === 'vendor') {
    await Vendor.create({ userId: user._id, businessName: name });
  }

  return success(res, { id: user._id, name: user.name, email: user.email, role: user.role }, 'Registered successfully.', 201);
});

const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  const passwordMatch = user ? await user.comparePassword(password) : false;
  if (!user || !passwordMatch) return error(res, 'Invalid email or password.', 401);

  const accessToken = signAccessToken(user._id);
  const refreshToken = signRefreshToken(user._id);

  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  setRefreshCookie(res, refreshToken);

  return success(res, {
    accessToken,
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
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

  const otp = await otpService.createAndSaveOTP(user._id);
  emailService.sendOTPEmail({ to: user.email, name: user.name, otp }).catch((err) =>
    console.error('[OTP] Email send failed:', err.message)
  );

  return success(res, { userId: user._id }, 'OTP sent to your email and phone.');
});

const verifyOTP = catchAsync(async (req, res) => {
  const { userId, otp } = req.body;

  const result = await otpService.verifyOTP(userId, otp);
  if (!result.valid) return error(res, result.message, 400);

  const user = await User.findById(userId);
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
  return success(res, { accessToken });
});

const logout = catchAsync(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: '' } });
  res.clearCookie('refreshToken');
  return success(res, {}, 'Logged out successfully.');
});

const getMe = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).select('-passwordHash -refreshToken');
  if (!user) return error(res, 'User not found.', 404);
  return success(res, { user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
});

const updateProfile = catchAsync(async (req, res) => {
  const { name, phone } = req.body;
  if (!name?.trim()) return error(res, 'Name is required.', 400);

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { name: name.trim(), ...(phone ? { phone: phone.trim() } : {}) },
    { new: true, runValidators: true }
  ).select('-passwordHash -refreshToken');

  return success(res, { user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role } }, 'Profile updated.');
});

const forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email: email?.toLowerCase() });
  if (user) {
    // TODO: generate reset token, save to DB, send via email once Resend is configured
    console.log(`[ForgotPassword] Reset requested for: ${email}`);
  }

  // Always return success — don't reveal whether the email is registered
  return success(res, {}, 'If this email is registered, you will receive a reset link shortly.');
});

module.exports = { register, login, sendOTP, verifyOTP, refreshToken, logout, getMe, updateProfile, forgotPassword };
