const express = require('express');
const { register, login, sendOTP, verifyOTP, refreshToken, logout, getMe, updateProfile, changePassword, forgotPassword, resetPassword, getSavedVendors, saveVendor, unsaveVendor } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { registerRules, loginRules, otpRules, resetPasswordRules } = require('../validators/auth.validator');

const router = express.Router();

router.post('/register',   authLimiter, ...registerRules, validate, register);
router.post('/login',      authLimiter, ...loginRules, validate, login);
router.post('/send-otp',   otpLimiter, sendOTP);
router.post('/verify-otp', otpLimiter, ...otpRules, validate, verifyOTP);
router.post('/refresh',    refreshToken);
router.post('/logout',     protect, logout);
router.get('/me',          protect, getMe);
router.put('/profile',     protect, updateProfile);
router.put('/change-password', protect, changePassword);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password',  authLimiter, ...resetPasswordRules, validate, resetPassword);

router.get('/saved-vendors',             protect, getSavedVendors);
router.post('/saved-vendors/:vendorId',  protect, saveVendor);
router.delete('/saved-vendors/:vendorId',protect, unsaveVendor);

module.exports = router;
