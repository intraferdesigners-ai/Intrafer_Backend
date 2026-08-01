const { body } = require('express-validator');

const registerRules = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('phone').matches(/^[6-9]\d{9}$/).withMessage('Valid 10-digit Indian mobile number required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('role').isIn(['user', 'vendor']).withMessage('Role must be user or vendor'),
];

const loginRules = [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
];

// Same normalizeEmail() as registerRules/loginRules — without this, the
// homeowner OTP/enquiry path stored emails verbatim while vendor registration
// normalized them (e.g. stripping Gmail's +tag addressing), letting one real
// inbox create multiple homeowner accounts/leads via +alias variants and
// bypass per-email assumptions elsewhere (OTP rate limits, duplicate-lead
// checks). name/phone are intentionally left unvalidated here — sendOTP
// already handles their absence, and this fix is scoped to email consistency.
const sendOtpRules = [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
];

const otpRules = [
  body('userId').notEmpty().withMessage('userId is required'),
  body('otp')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
    .isNumeric().withMessage('OTP must be 6 digits'),
];

const resetPasswordRules = [
  body('token').trim().notEmpty().withMessage('Reset token is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

module.exports = { registerRules, loginRules, sendOtpRules, otpRules, resetPasswordRules };
