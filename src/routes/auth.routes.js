const express = require('express');
const { register, login, sendOTP, verifyOTP, refreshToken, logout, getMe, updateProfile, forgotPassword } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { registerRules, loginRules, otpRules } = require('../validators/auth.validator');

const router = express.Router();

router.post('/register',   authLimiter, ...registerRules, validate, register);
router.post('/login',      authLimiter, ...loginRules, validate, login);
router.post('/send-otp',   otpLimiter, sendOTP);
router.post('/verify-otp', otpLimiter, ...otpRules, validate, verifyOTP);
router.post('/refresh',    refreshToken);
router.post('/logout',     protect, logout);
router.get('/me',          protect, getMe);
router.put('/profile',     protect, updateProfile);
router.post('/forgot-password', authLimiter, forgotPassword);

module.exports = router;
