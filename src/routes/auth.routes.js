const express = require('express');
const {
  register, login, googleAuth, sendOTP, verifyOTP, refreshToken, logout, getMe, updateProfile, changePassword,
  forgotPassword, resetPassword, updateNotificationPreferences,
} = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { registerRules, loginRules, sendOtpRules, otpRules, resetPasswordRules, googleAuthRules } = require('../validators/auth.validator');

const router = express.Router();

router.post('/register',   authLimiter, ...registerRules, validate, register);
router.post('/login',      authLimiter, ...loginRules, validate, login);
router.post('/google',     authLimiter, ...googleAuthRules, validate, googleAuth);
router.post('/send-otp',   otpLimiter, ...sendOtpRules, validate, sendOTP);
router.post('/verify-otp', otpLimiter, ...otpRules, validate, verifyOTP);
router.post('/refresh',    refreshToken);
router.post('/logout',     protect, logout);
router.get('/me',          protect, getMe);
router.put('/profile',     protect, updateProfile);
router.put('/notification-preferences', protect, updateNotificationPreferences);
router.put('/change-password', protect, changePassword);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password',  authLimiter, ...resetPasswordRules, validate, resetPassword);

module.exports = router;
